/**
 * Heap / RSS instrumentation for Render 512MB instances.
 * Logs process.memoryUsage() around heavy routes without retaining payloads.
 */

const MB = 1024 * 1024;

/** Soft warn — caches should be eligible for drop. */
export const RSS_WARN_MB = 380;
/** Drop in-process collection caches to free RSS. */
export const RSS_DROP_CACHE_MB = 400;
/** Refuse Sharp / heavy image work (Render hard limit is 512). */
export const RSS_REFUSE_IMAGE_MB = 420;

export function memorySnapshot(label = '') {
  const m = process.memoryUsage();
  return {
    label: label || undefined,
    rssMb: +(m.rss / MB).toFixed(1),
    heapUsedMb: +(m.heapUsed / MB).toFixed(1),
    heapTotalMb: +(m.heapTotal / MB).toFixed(1),
    externalMb: +(m.external / MB).toFixed(1),
    arrayBuffersMb: +((m.arrayBuffers || 0) / MB).toFixed(1),
  };
}

export function logMemory(label, extra = {}) {
  const snap = memorySnapshot(label);
  const payload = { ...snap, ...extra };
  console.warn('[memory]', JSON.stringify(payload));
  return snap;
}

/** Run fn and log heap delta. Does not keep return value references beyond the call. */
export async function withMemoryLog(label, fn, extra = {}) {
  const before = memorySnapshot();
  try {
    return await fn();
  } finally {
    const after = memorySnapshot();
    console.warn(
      '[memory]',
      JSON.stringify({
        label,
        ...extra,
        beforeMb: before.heapUsedMb,
        afterMb: after.heapUsedMb,
        deltaMb: +(after.heapUsedMb - before.heapUsedMb).toFixed(1),
        rssMb: after.rssMb,
      })
    );
  }
}

/** Soft warn when RSS approaches Render starter limit. */
export function warnIfHighMemory(label, { rssWarnMb = RSS_WARN_MB } = {}) {
  const snap = memorySnapshot(label);
  if (snap.rssMb >= rssWarnMb) {
    console.warn('[memory:high]', JSON.stringify(snap));
  }
  return snap;
}

/**
 * Drop process-local Mongo collection caches when RSS is dangerous.
 * Safe on single-replica Render — next reads lazy-reload.
 */
export async function relieveMemoryPressure(label = 'relieve') {
  const before = memorySnapshot(label);
  if (before.rssMb < RSS_DROP_CACHE_MB) return { relieved: false, ...before };
  try {
    const { clearPersistenceCache, getCacheStats } = await import('../store/persistence.js');
    const { invalidateIdIndex } = await import('../store/filedb.js');
    const stats = getCacheStats();
    clearPersistenceCache();
    invalidateIdIndex();
    if (typeof global.gc === 'function') {
      try {
        global.gc();
      } catch {
        /* ignore */
      }
    }
    const after = memorySnapshot(`${label}:after`);
    console.warn(
      '[memory:relieve]',
      JSON.stringify({
        droppedCollections: stats.collectionCount,
        droppedDocs: stats.totalDocs,
        top: stats.collections?.slice(0, 8),
        beforeRssMb: before.rssMb,
        afterRssMb: after.rssMb,
        beforeHeapMb: before.heapUsedMb,
        afterHeapMb: after.heapUsedMb,
      }),
    );
    return { relieved: true, ...after, droppedDocs: stats.totalDocs };
  } catch (err) {
    console.warn(`[memory:relieve] failed: ${err?.message || err}`);
    return { relieved: false, ...before };
  }
}

/**
 * Hard gate before Sharp / multipart optimize.
 * @throws {{ message: string, status: number, code: string }}
 */
export function assertSafeRssForImageProcess(label = 'image') {
  const snap = warnIfHighMemory(label, { rssWarnMb: RSS_WARN_MB });
  if (snap.rssMb >= RSS_REFUSE_IMAGE_MB) {
    const err = new Error(
      `Server memory is too high (${snap.rssMb} MB). Wait a minute and try again, or upload a smaller WebP via direct upload.`,
    );
    err.status = 503;
    err.code = 'UPLOAD_MEMORY_PRESSURE';
    throw err;
  }
  return snap;
}

export function startMemoryWatch({ intervalMs = 120_000, rssWarnMb = RSS_WARN_MB } = {}) {
  const enabled =
    process.env.NODE_ENV === 'production' ||
    String(process.env.MEMORY_LOG || '').toLowerCase() === 'true';
  if (!enabled) return () => {};
  const timer = setInterval(() => {
    const snap = warnIfHighMemory('watch', { rssWarnMb });
    import('../store/persistence.js')
      .then(({ getCacheStats }) => {
        const stats = getCacheStats();
        if (stats.totalDocs > 0 || snap.rssMb >= rssWarnMb) {
          console.warn(
            '[memory:cache]',
            JSON.stringify({
              rssMb: snap.rssMb,
              heapUsedMb: snap.heapUsedMb,
              totalDocs: stats.totalDocs,
              collections: stats.collections?.slice(0, 10),
            }),
          );
        }
      })
      .catch(() => {});
    if (snap.rssMb >= RSS_DROP_CACHE_MB) {
      relieveMemoryPressure('watch').catch(() => {});
    }
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
