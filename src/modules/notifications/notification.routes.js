import { Router } from 'express';
import fs from 'fs';
import { authenticate, requirePermission, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler, AppError, parsePagination, paginated } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { Notification } from './notification.model.js';
import { resolveImportErrorReport } from '../imports/importErrorReport.js';
import { isArchived } from '../retention/archivePolicy.js';
import { archiveExpiredForUser, archiveExpiredNotifications } from './notificationArchive.js';

const router = Router();
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.NOTIFICATIONS_READ));

function isDue(n, nowMs) {
  if (!n.scheduledFor) return true;
  return new Date(n.scheduledFor).getTime() <= nowMs;
}

function isActive(n) {
  return !n.cancelledAt;
}

async function deliverDueForUser(userId) {
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const pending = await Notification.find({ userId }).limit(500);

  for (const n of pending) {
    if (!isActive(n) || n.deliveredAt) continue;
    if (n.scheduledFor && isDue(n, nowMs)) {
      n.deliveredAt = nowIso;
      await n.save();
    }
  }
}

function matchesFilters(n, query) {
  if (query.priority) {
    if (String(n.priority || 'informational').toLowerCase() !== String(query.priority).toLowerCase()) {
      return false;
    }
  }
  if (query.module) {
    if (String(n.module || '').toLowerCase() !== String(query.module).toLowerCase()) {
      return false;
    }
  }
  if (query.type) {
    if (String(n.type || '') !== String(query.type)) return false;
  }
  if (query.category) {
    const cat = String(query.category).toLowerCase();
    const module = String(n.module || 'system').toLowerCase();
    const type = String(n.type || '').toLowerCase();
    if (cat === 'workflow' && !/camp_|asset_|movement_|agreement_|picklist_|commercial_/i.test(type)) {
      return false;
    }
    if (cat === 'system' && module !== 'system') return false;
    if (cat === 'alerts' && String(n.priority || '') !== 'critical') return false;
    if (!['workflow', 'system', 'alerts', ''].includes(cat) && module !== cat) return false;
  }
  if (query.q) {
    const q = String(query.q).trim().toLowerCase();
    if (q) {
      const hay = `${n.title || ''} ${n.body || ''} ${n.type || ''} ${n.actorEmail || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }
  return true;
}

function serializeNotification(n) {
  const row = typeof n.toObject === 'function' ? n.toObject() : { ...n };
  if (row.meta?.errors) {
    row.meta = { ...row.meta, errors: undefined, errorsOmitted: true };
  }
  return row;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    await archiveExpiredForUser(req.user._id);
    await deliverDueForUser(req.user._id);

    const nowMs = Date.now();
    const { page, limit } = parsePagination(req.query, { maxLimit: 100 });
    const filter = { userId: req.user._id };
    if (req.query.unread === 'true') filter.readAt = null;
    const showArchived =
      req.query.archive === '1'
      || req.query.archive === 'true'
      || req.query.archived === '1';

    // Latest → oldest; fetch a bounded window then filter/paginate in memory
    // (scheduled / archive flags are not pure Mongo predicates across file + mongo backends).
    const fetchCap = Math.min(2000, Math.max(limit * page + limit, 400));
    const all = await Notification.find(filter).sort({ createdAt: -1 }).limit(fetchCap);
    const filtered = all
      .filter((n) => isActive(n) && isDue(n, nowMs))
      .filter((n) => (showArchived ? isArchived(n) : !isArchived(n)))
      .filter((n) => matchesFilters(n, req.query));

    const total = filtered.length;
    const start = (page - 1) * limit;
    const data = filtered.slice(start, start + limit).map(serializeNotification);

    res.json(paginated(data, total, page, limit));
  })
);

/** Lightweight poll for Layout badge — no notification bodies or meta. */
router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    await archiveExpiredForUser(req.user._id);
    await deliverDueForUser(req.user._id);
    const nowMs = Date.now();
    const pending = await Notification.find({
      userId: req.user._id,
      readAt: null,
    })
      .sort({ createdAt: -1 })
      .limit(200);
    let count = 0;
    const ids = [];
    for (const n of pending) {
      if (!isActive(n) || !isDue(n, nowMs) || isArchived(n)) continue;
      count += 1;
      if (ids.length < 20) ids.push(String(n._id));
    }
    res.json({ data: { count, sampleIds: ids } });
  })
);

router.post(
  '/archive-due',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await archiveExpiredNotifications({ limit: 1000 });
    res.json({ data: result });
  })
);

router.get(
  '/:id/error-report',
  asyncHandler(async (req, res) => {
    const n = await Notification.findOne({ _id: req.params.id, userId: req.user._id });
    if (!n || n.cancelledAt) throw new AppError('Notification not found', 404);
    if (n.type !== 'IMPORT_ERRORS') {
      throw new AppError('No error report on this notification', 404, 'NOT_FOUND');
    }

    const report = resolveImportErrorReport(n.meta || {});
    if (!report?.buffer) throw new AppError('Error report file not found', 404, 'NOT_FOUND');

    const fileName = String(report.fileName || 'Import_Errors.xlsx').replace(/[^\w.\- ]+/g, '_');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(report.buffer);

    if (report.legacyPath) {
      try {
        fs.unlinkSync(report.legacyPath);
      } catch {
        /* ignore */
      }
    }
  })
);

router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const n = await Notification.findOne({ _id: req.params.id, userId: req.user._id });
    if (!n || n.cancelledAt) throw new AppError('Notification not found', 404);
    n.readAt = new Date();
    await n.save();
    res.json({ data: n });
  })
);

router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await Notification.updateMany(
      { userId: req.user._id, readAt: null },
      { $set: { readAt: new Date() } }
    );
    res.json({ data: { ok: true } });
  })
);

export default router;
