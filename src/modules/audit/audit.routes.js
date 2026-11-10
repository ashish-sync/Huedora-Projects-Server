import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { AppError, asyncHandler, parsePagination, paginated } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { AuditLog } from './audit.model.js';
import { escapeRegex } from '../../utils/escapeRegex.js';
import {
  applyActivityLogFilters,
  applyDefaultActivityWindow,
  applyProgrammeScopeFilter,
  applyRoutineExclusion,
  slimActivityListRow,
} from './activityLog.js';
import { queryCollection } from '../../store/persistence.js';
import { resolveCampClientScope } from '../campOps/campOps.clientAccess.js';

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
    if (req.query.entityId) filter.entityId = String(req.query.entityId).trim();
    if (req.query.actorId) filter.actorId = req.query.actorId;
    // Date + ISO-string dual match is applied in applyDefaultActivityWindow —
    // audit `at` is persisted as an ISO string via JSON clone on write.
    applyDefaultActivityWindow(filter, req.query);
    applyActivityLogFilters(filter, req.query);
    applyRoutineExclusion(filter, req.query);

    const scope = await resolveCampClientScope(req.user || {});
    if (scope !== null) {
      const programmeIds = [...new Set(
        scope.map((row) => String(row.programName || '').trim()).filter(Boolean),
      )];
      applyProgrammeScopeFilter(filter, programmeIds);
    }

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

    const scope = await resolveCampClientScope(req.user || {});
    if (scope !== null) {
      const allowed = new Set(
        scope.map((item) => String(item.programName || '').trim()).filter(Boolean),
      );
      const programmeId = String(row.programmeId || '').trim();
      if (!programmeId || !allowed.has(programmeId)) {
        throw new AppError('Activity not found', 404, 'NOT_FOUND');
      }
    }

    res.json({ data: row });
  })
);

export default router;
