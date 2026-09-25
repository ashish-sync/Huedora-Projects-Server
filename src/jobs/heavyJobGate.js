/**
 * Bounded gate for heap-heavy work (IMAP, imports, LibreOffice-adjacent jobs).
 * Concurrency 1 so free-tier web dynos cannot stack Sharp/IMAP/import at once.
 * Media/Sharp still uses imageProcessGate; this covers non-image heavy paths.
 */

const CONCURRENCY = Math.max(1, Number(process.env.HEAVY_JOB_CONCURRENCY) || 1);
const MAX_QUEUE = Math.max(CONCURRENCY, Number(process.env.HEAVY_JOB_MAX_QUEUE) || 20);

let active = 0;
/** @type {Array<{ resolve: () => void, reject: (e: Error) => void }>} */
const waiters = [];

function pump() {
  while (active < CONCURRENCY && waiters.length) {
    const next = waiters.shift();
    active += 1;
    next.resolve();
  }
}

function acquire() {
  if (active < CONCURRENCY && waiters.length === 0) {
    active += 1;
    return Promise.resolve();
  }
  if (active + waiters.length >= MAX_QUEUE) {
    return Promise.reject(
      Object.assign(new Error('Server is busy with another heavy job. Retry shortly.'), {
        status: 503,
        code: 'HEAVY_JOB_BUSY',
      }),
    );
  }
  return new Promise((resolve, reject) => {
    waiters.push({ resolve, reject });
  });
}

function release() {
  active = Math.max(0, active - 1);
  pump();
}

export function heavyJobGateStats() {
  return { active, waiting: waiters.length, concurrency: CONCURRENCY, maxQueue: MAX_QUEUE };
}

/**
 * @template T
 * @param {string} label
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withHeavyJobGate(label, fn) {
  await acquire();
  const started = Date.now();
  try {
    if (process.env.MEMORY_LOG === 'true') {
      console.log(`[heavy-job] start label=${label} ${JSON.stringify(heavyJobGateStats())}`);
    }
    return await fn();
  } finally {
    release();
    if (process.env.MEMORY_LOG === 'true') {
      console.log(
        `[heavy-job] done label=${label} ms=${Date.now() - started} ${JSON.stringify(heavyJobGateStats())}`,
      );
    }
  }
}
