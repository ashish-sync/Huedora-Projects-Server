import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { AppError, asyncHandler, parsePagination, paginated } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { AuditLog } from './audit.model.js';
import { escapeRegex } from '../../utils/escapeRegex.js';
import {
  applyActivityLogFilters,
  applyDefaultActivityWindow,
  slimActivityListRow,
} from './activityLog.js';
import { queryCollection } from '../../store/persistence.js';

const router = Router();
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.AUDIT_READ));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.action) filter.action = new RegExp(escapeRegex(String(req.query.action)), 'i');
    if (req.query.entityType) filter.entityType = req.query.entityType;
    if (req.query.entityId) filter.entityId = req.query.entityId;
    if (req.query.actorId) filter.actorId = req.query.actorId;
    if (req.query.from || req.query.to) {
      filter.at = {};
      if (req.query.from) filter.at.$gte = new Date(req.query.from);
      if (req.query.to) filter.at.$lte = new Date(req.query.to);
    }
    applyDefaultActivityWindow(filter, req.query);
    applyActivityLogFilters(filter, req.query);
    const { data, total } = await queryCollection('audit_logs', {
      filter,
      sort: { at: -1 },
      skip,
      limit,
      maxTimeMS: 8000,
    });
    res.json(paginated(data.map(slimActivityListRow), total, page, limit));
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await AuditLog.findById(req.params.id);
    if (!row) throw new AppError('Activity not found', 404, 'NOT_FOUND');
    res.json({ data: row });
  })
);

export default router;
