import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, AppError, parsePagination, paginated } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { PicklistSuggestion } from './picklist.model.js';
import {
  PICKLIST_REGISTRY,
  getRegistryEntry,
  mergePicklistOptions,
  normalizePicklistValue,
} from './picklist.registry.js';
import { Notification } from '../notifications/notification.model.js';
import { User } from '../users/user.model.js';
import { Role } from '../users/role.model.js';
import { writeAudit } from '../../utils/audit.js';

const router = Router();
router.use(authenticate);

const canApprove = requirePermission(
  PERMISSIONS.LOGISTICS_MASTER,
  PERMISSIONS.LOGISTICS_WRITE,
  PERMISSIONS.AGREEMENTS_WRITE,
  PERMISSIONS.ALL
);

function isOtherSentinel(value, otherLabel) {
  const n = normalizePicklistValue(value);
  return n === normalizePicklistValue(otherLabel) || n === 'other' || n === 'others';
}

export async function listApprovedValues(picklistKey) {
  const rows = await PicklistSuggestion.find({
    picklistKey,
    status: 'APPROVED',
    isDeleted: false,
  });
  return rows.map((r) => r.value).filter(Boolean);
}

export async function resolvePicklistOptions(picklistKey) {
  const entry = getRegistryEntry(picklistKey);
  if (!entry) throw new AppError(`Unknown picklist: ${picklistKey}`, 404);
  const approved = await listApprovedValues(picklistKey);
  return {
    key: picklistKey,
    label: entry.label,
    otherLabel: entry.otherLabel,
    options: mergePicklistOptions(entry.staticOptions, approved, entry.otherLabel),
    staticOptions: entry.staticOptions,
    approvedOptions: approved,
  };
}

/** True if value is a known static option, approved value, or acceptable custom Other text */
export async function isAllowedPicklistValue(picklistKey, value) {
  const entry = getRegistryEntry(picklistKey);
  if (!entry) return false;
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (isOtherSentinel(raw, entry.otherLabel)) return false;
  const n = normalizePicklistValue(raw);
  for (const o of entry.staticOptions) {
    if (normalizePicklistValue(o) === n && !isOtherSentinel(o, entry.otherLabel)) return true;
  }
  const approved = await listApprovedValues(picklistKey);
  if (approved.some((o) => normalizePicklistValue(o) === n)) return true;
  // Custom Other text is allowed on records while suggestion is pending
  return true;
}

async function findMasterWriters(excludeUserId) {
  const roles = await Role.find({ isDeleted: false });
  const roleById = new Map(roles.map((r) => [String(r._id), r]));
  const users = await User.find({ isDeleted: false, isActive: true });
  return users.filter((u) => {
    if (excludeUserId && String(u._id) === String(excludeUserId)) return false;
    const roleIds = (u.roleIds || []).map((id) => String(id?._id || id));
    return roleIds.some((rid) => {
      const role = roleById.get(rid);
      if (!role) return false;
      const perms = role.permissions || [];
      return (
        perms.includes(PERMISSIONS.ALL) ||
        perms.includes(PERMISSIONS.LOGISTICS_MASTER) ||
        perms.includes(PERMISSIONS.LOGISTICS_WRITE) ||
        perms.includes(PERMISSIONS.AGREEMENTS_WRITE)
      );
    });
  });
}

async function assertNotDuplicate(picklistKey, normalizedValue, otherLabel, excludeId = null) {
  const entry = getRegistryEntry(picklistKey);
  if (!entry) throw new AppError(`Unknown picklist: ${picklistKey}`, 404);

  if (isOtherSentinel(normalizedValue, otherLabel)) {
    throw new AppError('Enter a specific value instead of Other', 400, 'VALIDATION_ERROR');
  }

  for (const o of entry.staticOptions) {
    if (normalizePicklistValue(o) === normalizedValue && !isOtherSentinel(o, otherLabel)) {
      throw new AppError(`“${o}” is already in this dropdown`, 409, 'DUPLICATE');
    }
  }

  const existing = await PicklistSuggestion.find({
    picklistKey,
    isDeleted: false,
    status: { $in: ['PENDING', 'APPROVED'] },
  });
  const clash = existing.find(
    (r) =>
      r.normalizedValue === normalizedValue && (!excludeId || String(r._id) !== String(excludeId))
  );
  if (clash) {
    throw new AppError(
      clash.status === 'APPROVED'
        ? `“${clash.value}” is already in this dropdown`
        : `“${clash.value}” is already pending approval`,
      409,
      'DUPLICATE'
    );
  }
}

router.get(
  '/registry',
  asyncHandler(async (_req, res) => {
    res.json({
      data: Object.entries(PICKLIST_REGISTRY).map(([key, v]) => ({
        key,
        label: v.label,
        otherLabel: v.otherLabel,
      })),
    });
  })
);

router.get(
  '/suggestions',
  canApprove,
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.status) filter.status = String(req.query.status).toUpperCase();
    if (req.query.picklistKey) filter.picklistKey = String(req.query.picklistKey);
    const [data, total] = await Promise.all([
      PicklistSuggestion.find(filter)
        .sort(sort || '-createdAt')
        .skip(skip)
        .limit(limit),
      PicklistSuggestion.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.post(
  '/suggestions',
  asyncHandler(async (req, res) => {
    const picklistKey = String(req.body.picklistKey || '').trim();
    const value = String(req.body.value || '').trim();
    const source = String(req.body.source || '').trim();
    const entry = getRegistryEntry(picklistKey);
    if (!entry) throw new AppError(`Unknown picklist: ${picklistKey}`, 400, 'VALIDATION_ERROR');
    if (!value) throw new AppError('Value is required', 400, 'VALIDATION_ERROR');

    const normalizedValue = normalizePicklistValue(value);
    await assertNotDuplicate(picklistKey, normalizedValue, entry.otherLabel);

    const row = await PicklistSuggestion.create({
      picklistKey,
      value,
      normalizedValue,
      status: 'PENDING',
      source,
      requestedBy: req.user._id,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    const writers = await findMasterWriters(req.user._id);
    for (const w of writers) {
      await Notification.create({
        userId: w._id,
        type: 'PICKLIST_SUGGESTION',
        title: `New dropdown value needs approval`,
        body: `${entry.label}: “${value}”`,
        entityType: 'PicklistSuggestion',
        entityId: row._id,
      });
    }

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'PICKLIST.SUGGEST',
      entityType: 'PicklistSuggestion',
      entityId: row._id,
      after: row,
      requestId: req.requestId,
    });

    res.status(201).json({ data: row });
  })
);

router.post(
  '/suggestions/:id/approve',
  canApprove,
  asyncHandler(async (req, res) => {
    const row = await PicklistSuggestion.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Suggestion not found', 404);
    if (row.status !== 'PENDING') {
      throw new AppError('Only pending suggestions can be approved', 400, 'VALIDATION_ERROR');
    }
    const entry = getRegistryEntry(row.picklistKey);
    if (!entry) throw new AppError('Unknown picklist', 400, 'VALIDATION_ERROR');

    await assertNotDuplicate(row.picklistKey, row.normalizedValue, entry.otherLabel, row._id);

    row.status = 'APPROVED';
    row.approvedBy = req.user._id;
    row.approvedAt = new Date().toISOString();
    row.updatedBy = req.user._id;
    await row.save();

    if (row.requestedBy && String(row.requestedBy) !== String(req.user._id)) {
      await Notification.create({
        userId: row.requestedBy,
        type: 'PICKLIST_APPROVED',
        title: `Dropdown value approved`,
        body: `${entry.label}: “${row.value}” is now available`,
        entityType: 'PicklistSuggestion',
        entityId: row._id,
      });
    }

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'PICKLIST.APPROVE',
      entityType: 'PicklistSuggestion',
      entityId: row._id,
      after: row,
      requestId: req.requestId,
    });

    res.json({ data: row });
  })
);

router.post(
  '/suggestions/:id/reject',
  canApprove,
  asyncHandler(async (req, res) => {
    const row = await PicklistSuggestion.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Suggestion not found', 404);
    if (row.status !== 'PENDING') {
      throw new AppError('Only pending suggestions can be rejected', 400, 'VALIDATION_ERROR');
    }
    const entry = getRegistryEntry(row.picklistKey);
    const reason = String(req.body.reason || '').trim();

    row.status = 'REJECTED';
    row.rejectedBy = req.user._id;
    row.rejectedAt = new Date().toISOString();
    row.rejectReason = reason;
    row.updatedBy = req.user._id;
    await row.save();

    if (row.requestedBy && String(row.requestedBy) !== String(req.user._id)) {
      await Notification.create({
        userId: row.requestedBy,
        type: 'PICKLIST_REJECTED',
        title: `Dropdown value rejected`,
        body: `${entry?.label || row.picklistKey}: “${row.value}”${
          reason ? ` — ${reason}` : ''
        }`,
        entityType: 'PicklistSuggestion',
        entityId: row._id,
      });
    }

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'PICKLIST.REJECT',
      entityType: 'PicklistSuggestion',
      entityId: row._id,
      after: row,
      requestId: req.requestId,
    });

    res.json({ data: row });
  })
);

router.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const key = String(req.params.key || '').trim();
    // Support nested keys like contact.profession.client via param that may be encoded
    const data = await resolvePicklistOptions(key);
    res.json({ data });
  })
);

export default router;
