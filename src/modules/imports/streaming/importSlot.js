import { AppError } from '../utils/helpers.js';

/**
 * Limit concurrent heavy imports on a single API process (Render 512MB).
 * Queued callers wait; overflow beyond maxWaiting is rejected.
 */
let active = 0;
const waiters = [];
const MAX_CONCURRENT = 1;
const MAX_WAITING = 8;

export async function withImportSlot(fn) {
  if (active >= MAX_CONCURRENT) {
    if (waiters.length >= MAX_WAITING) {
      throw new AppError(
        'Another import is already running and the queue is full. Wait a minute, then try again with a smaller .csv file.',
        429,
        'RATE_LIMIT'
      );
    }
    await new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    const next = waiters.shift();
    if (next) next.resolve();
  }
}
