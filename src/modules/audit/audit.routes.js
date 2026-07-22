import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { AuditLog } from './audit.model.js';

const router = Router();
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.AUDIT_READ));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.action) filter.action = new RegExp(req.query.action, 'i');
    if (req.query.entityType) filter.entityType = req.query.entityType;
    if (req.query.entityId) filter.entityId = req.query.entityId;
    if (req.query.actorId) filter.actorId = req.query.actorId;
    if (req.query.from || req.query.to) {
      filter.at = {};
      if (req.query.from) filter.at.$gte = new Date(req.query.from);
      if (req.query.to) filter.at.$lte = new Date(req.query.to);
    }
    const [data, total] = await Promise.all([
      AuditLog.find(filter).sort({ at: -1 }).skip(skip).limit(limit),
      AuditLog.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

export default router;
