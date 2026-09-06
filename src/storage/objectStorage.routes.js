import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/helpers.js';
import { describeR2Config, getR2Env } from './r2Env.js';
import { probeObjectStore, probeObjectStoreWrite } from './objectStore.js';
import { mediaQueueStats, retryFailedMediaJobs, requeueStuckMediaJobs, storedFileStatusCounts } from './media/mediaQueue.js';
import { runFileColdStorageJob } from './media/coldStorageJob.js';

const router = Router();

/**
 * Admin-only R2 / object-storage status. Never returns secrets or signed URLs.
 * GET /api/v1/system/object-storage?probe=1       — HeadBucket
 * GET /api/v1/system/object-storage?probe=write  — Put+Head+Delete write probe
 */
router.get(
  '/object-storage',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const probeMode = String(req.query.probe || '').toLowerCase();
    const force = probeMode === '1' || probeMode === 'true' || probeMode === 'write';
    const cfg = getR2Env();
    const summary = describeR2Config(cfg);
    let probe = null;
    let writeProbe = null;
    if (cfg.enabled || force) {
      probe = await probeObjectStore({ force: true });
    }
    if (probeMode === 'write') {
      writeProbe = await probeObjectStoreWrite({ force: true });
    }
    const fileCounts = await storedFileStatusCounts();
    res.json({
      data: {
        ...summary,
        mediaQueue: mediaQueueStats(),
        storedFiles: fileCounts,
        probe: probe
          ? {
              ok: probe.ok,
              reason: probe.reason,
              checkedAt: probe.checkedAt,
            }
          : null,
        writeProbe: writeProbe
          ? {
              ok: writeProbe.ok,
              reason: writeProbe.reason,
              probeKey: writeProbe.probeKey,
              checkedAt: writeProbe.checkedAt,
            }
          : null,
      },
    });
  }),
);

/** POST /api/v1/system/media/retry-failed — re-put local masters for failed/pending rows */
router.post(
  '/media/retry-failed',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.body?.limit) || 25));
    const includePending = req.body?.includePending !== false;
    const result = await retryFailedMediaJobs({ limit, includePending });
    res.json({ data: result });
  }),
);

/** POST /api/v1/system/media/requeue-stuck — enqueue pending/failed local masters (same as boot recovery) */
router.post(
  '/media/requeue-stuck',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.body?.limit) || 50));
    const olderThanMs = Math.max(0, Number(req.body?.olderThanMs) || 0);
    const result = await requeueStuckMediaJobs({ limit, olderThanMs });
    res.json({ data: result });
  }),
);

/** POST /api/v1/system/media/cold-archive — run 90-day file IA job (optional dryRun) */
router.post(
  '/media/cold-archive',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const dryRun = Boolean(req.body?.dryRun);
    const limit = Math.min(500, Math.max(1, Number(req.body?.limit) || 100));
    const result = await runFileColdStorageJob({ dryRun, limit });
    res.json({ data: result });
  }),
);

export default router;
