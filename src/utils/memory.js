/**
 * Heap / RSS instrumentation for Render 512MB instances.
 * Logs process.memoryUsage() around heavy routes without retaining payloads.
 */

const MB = 1024 * 1024;

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
export function warnIfHighMemory(label, { rssWarnMb = 400 } = {}) {
  const snap = memorySnapshot(label);
  if (snap.rssMb >= rssWarnMb) {
    console.warn('[memory:high]', JSON.stringify(snap));
  }
  return snap;
}

export function startMemoryWatch({ intervalMs = 120_000, rssWarnMb = 400 } = {}) {
  const enabled =
    process.env.NODE_ENV === 'production' ||
    String(process.env.MEMORY_LOG || '').toLowerCase() === 'true';
  if (!enabled) return () => {};
  const timer = setInterval(() => {
    warnIfHighMemory('watch', { rssWarnMb });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
