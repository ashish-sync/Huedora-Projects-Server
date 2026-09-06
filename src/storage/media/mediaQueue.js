import { warnIfHighMemory } from '../../utils/memory.js';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 2000;

/** @type {{ id: string, absPath: string, originalName: string, mimetype: string, attempts: number }[]} */
const queue = [];
let running = false;
let seq = 0;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In-process media queue: concurrency 1, retries with backoff, memory-aware.
 */
export function enqueueMediaJob(job) {
  const id = `media-${Date.now()}-${++seq}`;
  queue.push({
    id,
    absPath: job.absPath,
    originalName: job.originalName || '',
    mimetype: job.mimetype || '',
    attempts: 0,
  });
  void pump();
  return id;
}

export function mediaQueueStats() {
  return { depth: queue.length, running };
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      if (!job) break;
      const mem = warnIfHighMemory('media:queue', { rssWarnMb: 380 });
      if (mem?.rssMb >= 400) {
        console.warn(`[media] deferring ${job.id}: high RSS ${mem.rssMb}MB`);
        queue.push(job);
        await delay(15_000);
        continue;
      }
      try {
        const { processUploadedMedia } = await import('./processUpload.js');
        await processUploadedMedia(job.absPath, {
          originalName: job.originalName,
          mimetype: job.mimetype,
        });
        console.log(`[media] processed ${job.id} path=${job.absPath}`);
      } catch (err) {
        job.attempts += 1;
        console.error(
          `[media] job ${job.id} failed attempt=${job.attempts}: ${err?.message || err}`,
        );
        if (job.attempts < MAX_ATTEMPTS) {
          await delay(BASE_DELAY_MS * 2 ** (job.attempts - 1));
          queue.push(job);
        } else {
          try {
            const { StoredFile } = await import('../../modules/files/storedFile.model.js');
            const { toUploadObjectKey } = await import('../uploadKeys.js');
            const key = toUploadObjectKey(job.absPath);
            if (key) {
              let row = await StoredFile.findOne({ objectKey: key, isDeleted: false });
              if (!row) {
                row = await StoredFile.create({
                  objectKey: key,
                  originalName: job.originalName,
                  contentType: job.mimetype,
                  status: 'failed',
                  lastError: String(err?.message || err).slice(0, 500),
                  processAttempts: job.attempts,
                  lastAccessedAt: new Date().toISOString(),
                });
              } else {
                row.status = 'failed';
                row.lastError = String(err?.message || err).slice(0, 500);
                row.processAttempts = job.attempts;
                await row.save();
              }
            }
          } catch (markErr) {
            console.error('[media] failed to mark job failed:', markErr?.message || markErr);
          }
        }
      }
    }
  } finally {
    running = false;
    if (queue.length) void pump();
  }
}

/** Retry all failed registry rows (admin). */
export async function retryFailedMediaJobs({ limit = 25 } = {}) {
  const { StoredFile } = await import('../../modules/files/storedFile.model.js');
  const { absoluteUploadPath } = await import('../uploadKeys.js');
  const { processUploadedMedia } = await import('./processUpload.js');
  const failed = await StoredFile.find({ status: 'failed', isDeleted: false });
  const list = (Array.isArray(failed) ? failed : []).slice(0, limit);
  let ok = 0;
  let err = 0;
  for (const row of list) {
    try {
      const abs = absoluteUploadPath(row.objectKey);
      await processUploadedMedia(abs, {
        originalName: row.originalName,
        mimetype: row.contentType,
      });
      ok += 1;
    } catch (e) {
      err += 1;
      row.processAttempts = Number(row.processAttempts || 0) + 1;
      row.lastError = String(e?.message || e).slice(0, 500);
      await row.save().catch(() => {});
    }
  }
  return { scanned: list.length, ok, err };
}
