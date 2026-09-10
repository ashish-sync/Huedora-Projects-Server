import fs from 'fs';
import { warnIfHighMemory } from '../../utils/memory.js';
import { toUploadObjectKey, absoluteUploadPath } from '../uploadKeys.js';
import {
  markStoredFileFailed,
  markStoredFileReady,
  putLocalMasterToR2,
  upsertStoredFile,
  storedFileStatusCounts,
} from './storedFileRegistry.js';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 2000;
/** Pending/failed rows older than this are re-enqueued on boot / recovery sweep. */
const STUCK_MS = 60_000;
/** After this many memory deferrals, run the job anyway (avoid infinite starve on free tier). */
const MAX_MEMORY_DEFERS = 4;

/**
 * @typedef {'process' | 'r2Put'} MediaJobType
 * @typedef {{
 *   id: string,
 *   type: MediaJobType,
 *   absPath: string,
 *   objectKey?: string,
 *   originalName: string,
 *   mimetype: string,
 *   contentType?: string,
 *   attempts: number,
 * }} MediaJob
 */

/** @type {MediaJob[]} */
const queue = [];
let running = false;
let seq = 0;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In-process media queue: concurrency 1, retries with backoff, memory-aware.
 * Jobs:
 * - process: full optimize + register + R2 (legacy)
 * - r2Put: put already-optimized local master to R2 only
 *
 * Failures after MAX_ATTEMPTS always mark stored_files status=failed (never silent).
 * In-flight jobs are lost on process restart — use requeueStuckMediaJobs() on boot.
 */
export function enqueueMediaJob(job) {
  const id = `media-${Date.now()}-${++seq}`;
  queue.push({
    id,
    type: job.type === 'r2Put' ? 'r2Put' : 'process',
    absPath: job.absPath,
    objectKey: job.objectKey || '',
    originalName: job.originalName || '',
    mimetype: job.mimetype || '',
    contentType: job.contentType || job.mimetype || '',
    attempts: 0,
    memoryDefers: 0,
  });
  void pump();
  return id;
}

/**
 * Enqueue R2 put for a file already written locally.
 * Ensures a pending registry row exists before queueing so crashes still surface.
 */
export async function enqueueR2Put({ absPath, objectKey, contentType, originalName } = {}) {
  if (!absPath) {
    console.error('[media] enqueueR2Put called without absPath');
    return null;
  }
  const key = objectKey || toUploadObjectKey(absPath);
  if (!key) {
    console.error(`[media] enqueueR2Put cannot resolve objectKey for ${absPath}`);
    return null;
  }

  try {
    await upsertStoredFile({
      objectKey: key,
      status: 'pending',
      contentType: contentType || '',
      originalName: originalName || '',
      lastError: '',
    });
  } catch (err) {
    console.error(`[media] pending registry upsert failed key=${key}:`, err?.message || err);
  }

  return enqueueMediaJob({
    type: 'r2Put',
    absPath,
    objectKey: key,
    contentType,
    originalName,
    mimetype: contentType,
  });
}

export function mediaQueueStats() {
  return { depth: queue.length, running };
}

async function runJob(job) {
  if (job.type === 'r2Put') {
    const { isObjectStoreEnabled } = await import('../objectStore.js');
    const key = job.objectKey || toUploadObjectKey(job.absPath);
    if (!key) throw new Error('r2Put missing objectKey');

    if (!isObjectStoreEnabled()) {
      await markStoredFileReady(key, {
        originalName: job.originalName,
        contentType: job.contentType || job.mimetype,
      });
      return;
    }

    if (!job.absPath || !fs.existsSync(job.absPath)) {
      throw new Error(`Local master missing for r2Put: ${key}`);
    }

    await putLocalMasterToR2(key, {
      contentType: job.contentType || job.mimetype,
      originalName: job.originalName,
    });
    return;
  }

  const { processUploadedMedia } = await import('./processUpload.js');
  await processUploadedMedia(job.absPath, {
    originalName: job.originalName,
    mimetype: job.mimetype,
  });
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
        job.memoryDefers = (job.memoryDefers || 0) + 1;
        if (job.memoryDefers < MAX_MEMORY_DEFERS) {
          console.warn(
            `[media] deferring ${job.id}: high RSS ${mem.rssMb}MB (defer ${job.memoryDefers}/${MAX_MEMORY_DEFERS})`,
          );
          queue.push(job);
          await delay(15_000);
          continue;
        }
        // Do not force past ~400MB — that regularly OOMs Render free (512MB).
        // Leave the job out of the in-process queue; requeueStuckMediaJobs recovers later.
        console.warn(
          `[media] skipping ${job.id}: RSS still ${mem.rssMb}MB after ${MAX_MEMORY_DEFERS} defers — will recover on requeue`,
        );
        continue;
      }
      try {
        await runJob(job);
        console.log(`[media] processed ${job.id} type=${job.type} path=${job.absPath}`);
      } catch (err) {
        job.attempts += 1;
        console.error(
          `[media] job ${job.id} failed attempt=${job.attempts}/${MAX_ATTEMPTS}: ${err?.message || err}`,
        );
        if (job.attempts < MAX_ATTEMPTS) {
          await delay(BASE_DELAY_MS * 2 ** (job.attempts - 1));
          queue.push(job);
        } else {
          const key = job.objectKey || toUploadObjectKey(job.absPath);
          await markStoredFileFailed(key, err, {
            attempts: job.attempts,
            originalName: job.originalName,
            contentType: job.contentType || job.mimetype,
          });
        }
      }
    }
  } finally {
    running = false;
    if (queue.length) void pump();
  }
}

/**
 * Retry failed (and optionally stuck pending) registry rows via R2 put of local masters.
 * Does not re-run sharp when the local file already exists.
 */
export async function retryFailedMediaJobs({ limit = 25, includePending = true } = {}) {
  const { StoredFile } = await import('../../modules/files/storedFile.model.js');
  const statuses = includePending ? ['failed', 'pending'] : ['failed'];
  const failed = await StoredFile.find({ status: { $in: statuses }, isDeleted: false });
  const list = (Array.isArray(failed) ? failed : []).slice(0, limit);
  let ok = 0;
  let err = 0;
  const errors = [];

  for (const row of list) {
    const key = String(row.objectKey || '').trim();
    try {
      if (!key) throw new Error('stored_files row missing objectKey');
      const abs = absoluteUploadPath(key);
      if (!fs.existsSync(abs)) {
        throw new Error(`Local master missing; cannot retry R2 put for ${key}`);
      }
      await putLocalMasterToR2(key, {
        contentType: row.contentType,
        originalName: row.originalName,
      });
      ok += 1;
    } catch (e) {
      err += 1;
      const message = String(e?.message || e).slice(0, 500);
      errors.push({ objectKey: key, error: message });
      row.status = 'failed';
      row.processAttempts = Number(row.processAttempts || 0) + 1;
      row.lastError = message;
      await row.save();
    }
  }

  return { ok, err, attempted: list.length, errors };
}

/**
 * Re-enqueue stuck pending/failed rows that still have a local master (boot + recovery).
 * Safe to call repeatedly; skips rows already in the in-memory queue for the same key.
 */
export async function requeueStuckMediaJobs({ olderThanMs = STUCK_MS, limit = 50 } = {}) {
  const { StoredFile } = await import('../../modules/files/storedFile.model.js');
  const { isObjectStoreEnabled } = await import('../objectStore.js');
  if (!isObjectStoreEnabled()) {
    return { enqueued: 0, skipped: 0, reason: 'object_store_disabled' };
  }

  const cutoff = Date.now() - olderThanMs;
  const rows = await StoredFile.find({
    status: { $in: ['pending', 'failed'] },
    isDeleted: false,
  });
  const list = (Array.isArray(rows) ? rows : []).slice(0, limit);
  const queuedKeys = new Set(
    queue.map((j) => String(j.objectKey || toUploadObjectKey(j.absPath) || '')).filter(Boolean),
  );

  let enqueued = 0;
  let skipped = 0;

  for (const row of list) {
    const key = String(row.objectKey || '').trim();
    if (!key) {
      skipped += 1;
      continue;
    }
    const updated = Date.parse(row.updatedAt || row.processedAt || row.lastAccessedAt || 0);
    if (Number.isFinite(updated) && updated > cutoff && row.status === 'pending') {
      skipped += 1;
      continue;
    }
    if (queuedKeys.has(key)) {
      skipped += 1;
      continue;
    }
    const abs = absoluteUploadPath(key);
    if (!fs.existsSync(abs)) {
      if (String(row.status) !== 'failed') {
        await markStoredFileFailed(key, 'Local master missing after restart', {
          attempts: Number(row.processAttempts || 0) + 1,
          originalName: row.originalName,
          contentType: row.contentType,
        });
      }
      skipped += 1;
      continue;
    }

    const wasFailed = String(row.status) === 'failed';
    row.status = 'pending';
    if (!wasFailed) row.lastError = '';
    await row.save();
    enqueueMediaJob({
      type: 'r2Put',
      absPath: abs,
      objectKey: key,
      contentType: row.contentType,
      originalName: row.originalName,
      mimetype: row.contentType,
    });
    queuedKeys.add(key);
    enqueued += 1;
  }

  return { enqueued, skipped, queueDepth: queue.length };
}

export { storedFileStatusCounts };
