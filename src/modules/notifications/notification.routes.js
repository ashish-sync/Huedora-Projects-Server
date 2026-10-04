import { Router } from 'express';
import fs from 'fs';
import { authenticate, requirePermission, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler, AppError, parsePagination, paginated } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { Notification } from './notification.model.js';
import { resolveImportErrorReport } from '../imports/importErrorReport.js';
import { archiveExpiredNotifications } from './notificationArchive.js';
import {
  LIST_SELECT,
  PREVIEW_SELECT,
  buildCategoryClause,
  buildInboxBaseFilter,
  buildListFilter,
  buildUnreadBadgeFilter,
  passesCategorySafety,
  serializeNotification,
} from './notificationQuery.js';
import { shouldReturnNotModified, weakUnreadEtag } from './unreadCountBadge.js';

const router = Router();
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.NOTIFICATIONS_READ));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit } = parsePagination(req.query, { maxLimit: 100 });
    const category = String(req.query.category || '').trim().toLowerCase();
    const filter = buildListFilter(req.user._id, req.query);

    // Over-fetch a small buffer so title-based legacy approvals can be safety-filtered
    // without hydrating hundreds of docs (old path fetched 400–2000).
    const safetyBuffer = category === 'approvals' || category === 'updates' ? Math.min(limit, 10) : 0;
    const fetchLimit = limit + safetyBuffer;
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(fetchLimit)
        .select(LIST_SELECT),
      Notification.countDocuments(filter),
    ]);

    const filtered = rows
      .map((n) => serializeNotification(n, { lean: true }))
      .filter((n) => passesCategorySafety(n, category))
      .slice(0, limit);

    res.json(paginated(filtered, total, page, limit));
  })
);

/**
 * Lightweight poll for Layout badge.
 * Badge `count` = actionable Approvals only (Updates/FYI do not inflate the red number).
 * Uses kind/type filters (index-friendly) + ETag so unchanged polls can 304.
 */
router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const approvalFilter = buildUnreadBadgeFilter(userId, 'approvals');
    // FYI bucket includes informational notices (bell “FYI / Notifications”).
    const fyiFilter = buildUnreadBadgeFilter(userId, 'updates', { informational: '1' });

    const [approvals, fyi, sample] = await Promise.all([
      Notification.countDocuments(approvalFilter),
      Notification.countDocuments(fyiFilter),
      Notification.find(approvalFilter)
        .sort({ createdAt: -1 })
        .limit(8)
        .select('_id'),
    ]);

    const sampleIds = sample.map((n) => String(n._id));
    const etag = weakUnreadEtag(approvals, fyi, sampleIds);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');

    if (shouldReturnNotModified(req.headers['if-none-match'], etag)) {
      return res.status(304).end();
    }

    res.json({
      data: {
        count: approvals,
        approvals,
        updates: fyi,
        fyi,
        total: approvals + fyi,
        sampleIds,
      },
    });
  })
);

/** Single round-trip for the header bell dropdown. */
router.get(
  '/preview',
  asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 5));

    const [approvalRows, updateRows] = await Promise.all([
      Notification.find(buildListFilter(userId, { unread: 'true', category: 'approvals' }))
        .sort({ createdAt: -1 })
        .limit(limit + 5)
        .select(PREVIEW_SELECT),
      Notification.find(buildListFilter(userId, { unread: 'true', category: 'updates' }))
        .sort({ createdAt: -1 })
        .limit(limit + 5)
        .select(PREVIEW_SELECT),
    ]);

    const approvals = approvalRows
      .map((n) => serializeNotification(n, { lean: true }))
      .filter((n) => passesCategorySafety(n, 'approvals'))
      .slice(0, limit);
    const updates = updateRows
      .map((n) => serializeNotification(n, { lean: true }))
      .filter((n) => passesCategorySafety(n, 'updates'))
      .slice(0, limit);

    res.json({ data: { approvals, updates } });
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
    res.json({ data: serializeNotification(n, { lean: true }) });
  })
);

router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const category = String(req.body?.category || req.query?.category || '').trim().toLowerCase();
    const now = new Date();
    const filter = buildInboxBaseFilter(req.user._id, { unread: 'true' });

    if (category && category !== 'all') {
      const clause = buildCategoryClause(category);
      if (clause) filter.$and = [...(filter.$and || []), clause];
    }

    const result = await Notification.updateMany(filter, { $set: { readAt: now } });
    const marked = Number(result?.modifiedCount ?? result?.nModified ?? 0);
    res.json({ data: { ok: true, marked } });
  })
);

export default router;
