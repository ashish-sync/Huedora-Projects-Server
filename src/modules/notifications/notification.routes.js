import { Router } from 'express';
import fs from 'fs';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { Notification } from './notification.model.js';
import { resolveImportErrorReportPath } from '../imports/importErrorReport.js';

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

router.get(
  '/',
  asyncHandler(async (req, res) => {
    await deliverDueForUser(req.user._id);

    const nowMs = Date.now();
    const filter = { userId: req.user._id };
    if (req.query.unread === 'true') filter.readAt = null;

    const all = await Notification.find(filter).sort({ createdAt: -1 }).limit(300);
    const data = all
      .filter((n) => isActive(n) && isDue(n, nowMs))
      .slice(0, 100)
      .map((n) => (typeof n.toObject === 'function' ? n.toObject() : n));

    res.json({ data });
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

    const filePath = resolveImportErrorReportPath(n.meta || {});
    if (!filePath) throw new AppError('Error report file not found', 404, 'NOT_FOUND');

    const fileName = String(n.meta?.fileName || 'Import_Errors.xlsx').replace(/[^\w.\- ]+/g, '_');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    fs.createReadStream(filePath).pipe(res);
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
