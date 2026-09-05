import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/helpers.js';
import { describeR2Config, getR2Env } from './r2Env.js';
import { probeObjectStore, probeObjectStoreWrite } from './objectStore.js';

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
    res.json({
      data: {
        ...summary,
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

export default router;
