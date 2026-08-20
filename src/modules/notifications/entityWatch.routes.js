import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { EntityWatch, findWatchForUser } from './entityWatch.model.js';
import { writeAudit } from '../../utils/audit.js';

const router = Router();
router.use(authenticate);
const canWatch = requirePermission(
  PERMISSIONS.CAMPS_READ,
  PERMISSIONS.CAMPS_REQUEST,
  PERMISSIONS.ASSETS_READ,
  PERMISSIONS.AGREEMENTS_READ,
  PERMISSIONS.VERIFICATIONS_READ,
  PERMISSIONS.MOVEMENTS_READ,
  PERMISSIONS.FINANCE_READ,
  PERMISSIONS.ASSET_REQUESTS_READ,
  PERMISSIONS.ALL
);

const WATCHABLE = new Set([
  'camp_ops_camp',
  'Camp',
  'AssetRequest',
  'FinanceCommercialDocument',
  'Agreement',
  'VerificationRecord',
  'Movement',
]);

function normalizeEntityType(raw) {
  return String(raw || '').trim();
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = { userId: req.user._id };
    if (req.query.entityType) filter.entityType = String(req.query.entityType);
    if (req.query.entityId) filter.entityId = String(req.query.entityId);
    const rows = await EntityWatch.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json({ data: rows });
  })
);

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const entityType = normalizeEntityType(req.query.entityType);
    const entityId = String(req.query.entityId || '').trim();
    if (!entityType || !entityId) {
      throw new AppError('entityType and entityId are required', 400, 'VALIDATION_ERROR');
    }
    const row = await findWatchForUser(req.user._id, entityType, entityId);
    res.json({ data: { watching: Boolean(row), watch: row || null } });
  })
);

router.post(
  '/',
  canWatch,
  asyncHandler(async (req, res) => {
    const entityType = normalizeEntityType(req.body?.entityType);
    const entityId = String(req.body?.entityId || '').trim();
    if (!entityType || !entityId) {
      throw new AppError('entityType and entityId are required', 400, 'VALIDATION_ERROR');
    }
    if (!WATCHABLE.has(entityType)) {
      throw new AppError('This record type cannot be watched', 400, 'VALIDATION_ERROR');
    }

    const existing = await findWatchForUser(req.user._id, entityType, entityId);
    if (existing) {
      return res.json({ data: existing });
    }

    const row = await EntityWatch.create({
      userId: req.user._id,
      entityType,
      entityId,
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'EntityWatch.CREATE',
      entityType: 'EntityWatch',
      entityId: row._id,
      after: { entityType, entityId, userId: req.user._id },
      requestId: req.requestId,
    });

    res.status(201).json({ data: row });
  })
);

router.delete(
  '/',
  canWatch,
  asyncHandler(async (req, res) => {
    const entityType = normalizeEntityType(req.body?.entityType || req.query?.entityType);
    const entityId = String(req.body?.entityId || req.query?.entityId || '').trim();
    if (!entityType || !entityId) {
      throw new AppError('entityType and entityId are required', 400, 'VALIDATION_ERROR');
    }
    const existing = await findWatchForUser(req.user._id, entityType, entityId);
    if (!existing) {
      return res.json({ data: { ok: true, removed: false } });
    }
    await EntityWatch.deleteOne({ _id: existing._id });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'EntityWatch.DELETE',
      entityType: 'EntityWatch',
      entityId: existing._id,
      before: { entityType, entityId, userId: req.user._id },
      requestId: req.requestId,
    });

    res.json({ data: { ok: true, removed: true } });
  })
);

export default router;
