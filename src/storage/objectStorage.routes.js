import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/helpers.js';
import { describeR2Config, getR2Env } from './r2Env.js';
import { probeObjectStore } from './objectStore.js';

const router = Router();

/**
 * Admin-only R2 / object-storage status. Never returns secrets or signed URLs.
 * GET /api/v1/system/object-storage?probe=1  — force HeadBucket
 */
router.get(
  '/object-storage',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const force = String(req.query.probe || '') === '1' || String(req.query.probe || '').toLowerCase() === 'true';
    const cfg = getR2Env();
    const summary = describeR2Config(cfg);
    let probe = null;
    if (cfg.enabled || force) {
      probe = await probeObjectStore({ force: true });
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
      },
    });
  }),
);

export default router;
