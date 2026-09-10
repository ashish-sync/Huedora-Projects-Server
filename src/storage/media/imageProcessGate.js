/**
 * Process-wide gate so concurrent uploads cannot spike Sharp/RSS past Render 512MB.
 */
import {
  withMemoryLog,
  warnIfHighMemory,
  logMemory,
  assertSafeRssForImageProcess,
  relieveMemoryPressure,
  RSS_DROP_CACHE_MB,
} from '../../utils/memory.js';
import { IMAGE_PROCESS_CONCURRENCY } from './uploadLimits.js';

let active = 0;
const waiters = [];

function pump() {
  while (active < IMAGE_PROCESS_CONCURRENCY && waiters.length) {
    const next = waiters.shift();
    active += 1;
    next();
  }
}

function acquire() {
  return new Promise((resolve) => {
    waiters.push(resolve);
    pump();
  });
}

function release() {
  active = Math.max(0, active - 1);
  pump();
}

export function imageProcessGateStats() {
  return { active, waiting: waiters.length, concurrency: IMAGE_PROCESS_CONCURRENCY };
}

/**
 * Run an image optimize / encode job under the global concurrency gate with memory logs.
 * @template T
 * @param {string} label
 * @param {() => Promise<T>} fn
 * @param {Record<string, unknown>} [extra]
 * @returns {Promise<T>}
 */
export async function withImageProcessGate(label, fn, extra = {}) {
  const snap = warnIfHighMemory(`gate:wait:${label}`, { rssWarnMb: 360 });
  if (snap.rssMb >= RSS_DROP_CACHE_MB) {
    await relieveMemoryPressure(`gate:${label}`);
  }
  assertSafeRssForImageProcess(`gate:${label}`);
  logMemory(`gate:queue:${label}`, { ...extra, ...imageProcessGateStats() });
  await acquire();
  try {
    assertSafeRssForImageProcess(`gate:run:${label}`);
    return await withMemoryLog(`gate:run:${label}`, fn, {
      ...extra,
      ...imageProcessGateStats(),
    });
  } finally {
    release();
    logMemory(`gate:done:${label}`, { ...extra, ...imageProcessGateStats() });
  }
}
