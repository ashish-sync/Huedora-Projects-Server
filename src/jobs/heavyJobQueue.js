/**
 * Durable heavy-job queue (Mongo-backed when available).
 * Web enqueues; worker (or in-process pump) drains under concurrency 1.
 * Tracks RSS, queue age, and duration for ops visibility.
 */
import { randomBytes } from 'crypto';
import { withHeavyJobGate, heavyJobGateStats } from './heavyJobGate.js';

const COLLECTION = 'heavy_jobs';
const POLL_MS = Math.max(2000, Number(process.env.HEAVY_JOB_POLL_MS) || 5000);
const MAX_ATTEMPTS = 3;

/** @type {ReturnType<typeof setInterval> | null} */
let pumpTimer = null;
let draining = false;

function oid() {
  return randomBytes(12).toString('hex');
}

async function store() {
  const { getPersistenceMode, getMongoDb, mongoCollectionName, upsertDocument, loadCollection } =
    await import('../store/persistence.js');
  return { getPersistenceMode, getMongoDb, mongoCollectionName, upsertDocument, loadCollection };
}

async function saveJob(job) {
  const { upsertDocument } = await store();
  await upsertDocument(COLLECTION, job);
  return job;
}

async function findPending(limit = 5) {
  const { getPersistenceMode, getMongoDb, mongoCollectionName, loadCollection } = await store();
  if (getPersistenceMode() === 'mongo') {
    const db = getMongoDb();
    if (!db) return [];
    return db
      .collection(mongoCollectionName(COLLECTION))
      .find({ status: 'pending' })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();
  }
  const rows = await loadCollection(COLLECTION);
  return rows
    .filter((r) => r.status === 'pending' && !r.isDeleted)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(0, limit);
}

/**
 * @param {{ type: string, payload?: object, label?: string }} job
 */
export async function enqueueHeavyJob({ type, payload = {}, label = '' } = {}) {
  const now = new Date().toISOString();
  const job = {
    _id: oid(),
    type: String(type || 'unknown'),
    label: String(label || type || 'job'),
    payload: payload && typeof payload === 'object' ? payload : {},
    status: 'pending',
    attempts: 0,
    result: null,
    error: '',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    isDeleted: false,
  };
  await saveJob(job);
  ensureHeavyJobPump();
  return { jobId: job._id, status: job.status };
}

export async function getHeavyJob(jobId) {
  const { getPersistenceMode, getMongoDb, mongoCollectionName, loadCollection } = await store();
  const id = String(jobId || '');
  if (!id) return null;
  if (getPersistenceMode() === 'mongo') {
    const db = getMongoDb();
    if (!db) return null;
    return db.collection(mongoCollectionName(COLLECTION)).findOne({ _id: id, isDeleted: { $ne: true } });
  }
  const rows = await loadCollection(COLLECTION);
  return rows.find((r) => String(r._id) === id && !r.isDeleted) || null;
}

export function heavyJobQueueStats() {
  return {
    draining,
    pumpActive: Boolean(pumpTimer),
    gate: heavyJobGateStats(),
    rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
  };
}

async function runJobBody(job) {
  if (job.type === 'imap-sync') {
    const { syncImapMailboxWork } = await import(
      '../modules/campOps/communications/services/inboundEmailService.js'
    );
    return syncImapMailboxWork(job.payload || {});
  }
  throw new Error(`Unknown heavy job type: ${job.type}`);
}

async function claimAndRun(job) {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  job.status = 'running';
  job.startedAt = startedAt;
  job.updatedAt = startedAt;
  job.attempts = Number(job.attempts || 0) + 1;
  await saveJob(job);

  try {
    const result = await withHeavyJobGate(job.label || job.type, () => runJobBody(job));
    job.status = 'completed';
    job.result = result;
    job.error = '';
    job.finishedAt = new Date().toISOString();
    job.durationMs = Date.now() - started;
    job.updatedAt = job.finishedAt;
    await saveJob(job);
    console.log(
      `[heavy-queue] completed id=${job._id} type=${job.type} ms=${job.durationMs} rssMb=${heavyJobQueueStats().rssMb}`,
    );
  } catch (err) {
    job.error = String(err?.message || err).slice(0, 500);
    job.finishedAt = new Date().toISOString();
    job.durationMs = Date.now() - started;
    job.updatedAt = job.finishedAt;
    if (job.attempts < MAX_ATTEMPTS) {
      job.status = 'pending';
      console.warn(
        `[heavy-queue] retry id=${job._id} attempt=${job.attempts}/${MAX_ATTEMPTS}: ${job.error}`,
      );
    } else {
      job.status = 'failed';
      console.error(`[heavy-queue] failed id=${job._id}: ${job.error}`);
    }
    await saveJob(job);
  }
}

export async function drainHeavyJobs({ limit = 3 } = {}) {
  if (draining) return { skipped: true };
  draining = true;
  try {
    const pending = await findPending(limit);
    for (const job of pending) {
      const ageMs = Date.now() - new Date(job.createdAt || Date.now()).getTime();
      console.log(
        `[heavy-queue] claim id=${job._id} type=${job.type} ageMs=${ageMs} ${JSON.stringify(heavyJobQueueStats())}`,
      );
      await claimAndRun(job);
    }
    return { processed: pending.length };
  } finally {
    draining = false;
  }
}

/** Start background pump (web or worker). Idempotent. */
export function ensureHeavyJobPump() {
  if (pumpTimer) return;
  pumpTimer = setInterval(() => {
    void drainHeavyJobs({ limit: 2 });
  }, POLL_MS);
  if (typeof pumpTimer.unref === 'function') pumpTimer.unref();
  void drainHeavyJobs({ limit: 2 });
}

/**
 * Wait for a job to finish (used when HTTP must stay sync-compatible).
 * Worker/web pump must be running.
 */
export async function awaitHeavyJob(jobId, { timeoutMs = 120_000, pollMs = 750 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await getHeavyJob(jobId);
    if (!job) throw new Error('Heavy job not found');
    if (job.status === 'completed') return job.result;
    if (job.status === 'failed') {
      throw Object.assign(new Error(job.error || 'Heavy job failed'), {
        status: 500,
        code: 'HEAVY_JOB_FAILED',
      });
    }
    // Help free-tier single process make progress while waiting.
    if (!draining) void drainHeavyJobs({ limit: 1 });
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw Object.assign(new Error('Heavy job timed out'), { status: 504, code: 'HEAVY_JOB_TIMEOUT' });
}
