import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import {
  AssetRequest,
  ALL_REQUEST_TYPES,
  ASSET_REQUIRED_TYPES,
  normalizeRequestType,
  typeLabel,
} from './assetRequest.model.js';
import { Asset } from '../assets/asset.model.js';
import { Contact } from '../contacts/contact.model.js';
import { nextSequence } from '../../utils/counters.js';
import { writeAudit } from '../../utils/audit.js';
import { Notification } from '../notifications/notification.model.js';
import { User } from '../users/user.model.js';
import { Role } from '../users/role.model.js';
import { sendExcel } from '../../utils/excelExport.js';

const router = Router();
router.use(authenticate);

const canRead = requirePermission(
  PERMISSIONS.ASSET_REQUESTS_READ,
  PERMISSIONS.ASSET_REQUESTS_REQUEST,
  PERMISSIONS.ASSET_REQUESTS_APPROVE,
  PERMISSIONS.MOVEMENTS_READ,
  PERMISSIONS.REPAIRS_READ
);
const canRequest = requirePermission(
  PERMISSIONS.ASSET_REQUESTS_REQUEST,
  PERMISSIONS.MOVEMENTS_REQUEST,
  PERMISSIONS.REPAIRS_WRITE,
  PERMISSIONS.MAINTENANCE_WRITE
);
const canApprove = requirePermission(
  PERMISSIONS.ASSET_REQUESTS_APPROVE,
  PERMISSIONS.MOVEMENTS_APPROVE
);

function contactIdOf(asset) {
  if (!asset) return null;
  const raw = asset.contactId || asset.hcwId;
  if (!raw) return null;
  if (typeof raw === 'object') return raw._id || raw.id || null;
  return raw;
}

async function buildLinkedSnapshot(assetId) {
  const asset = await Asset.findOne({ _id: assetId, isDeleted: false });
  if (!asset) throw new AppError('Asset not found', 404);

  const cid = contactIdOf(asset);
  let contact = null;
  if (cid) {
    contact = await Contact.findOne({ _id: cid, isDeleted: false });
  }

  return {
    assetId: asset._id,
    assetTag: asset.assetTag || null,
    serialNumber: asset.serialNumber || null,
    assetName: asset.deviceNameSnapshot || asset.name || '',
    assetCustody: asset.custody || '',
    custodianState: asset.custodianState || asset.location?.state || contact?.state || '',
    custodianName: asset.custodianName || contact?.name || '',
    custodianContact: asset.custodianContact || contact?.contact || contact?.mobile || '',
    custodianCity: asset.custodianCity || asset.location?.city || contact?.city || '',
    contactId: contact?._id || cid || null,
    fromStatus: asset.status,
  };
}

function emptyLinkedSnapshot() {
  return {
    assetId: null,
    assetTag: null,
    serialNumber: null,
    assetName: '',
    assetCustody: '',
    custodianState: '',
    custodianName: '',
    custodianContact: '',
    custodianCity: '',
    contactId: null,
    fromStatus: null,
  };
}

function pickDetails(body = {}) {
  const num = (v) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    priority: body.priority?.trim() || '',
    issueCategory: body.issueCategory?.trim() || '',
    maintenanceKind: body.maintenanceKind?.trim() || '',
    logisticsKind: body.logisticsKind?.trim() || '',
    preferredVendor: body.preferredVendor?.trim() || '',
    serviceProvider: body.serviceProvider?.trim() || '',
    expectedDate: body.expectedDate?.trim() || '',
    scheduledDate: body.scheduledDate?.trim() || '',
    preferredDate: body.preferredDate?.trim() || '',
    transportMode: body.transportMode?.trim() || '',
    trainingTopic: body.trainingTopic?.trim() || '',
    trainingMode: body.trainingMode?.trim() || '',
    traineeCount: num(body.traineeCount),
    venue: body.venue?.trim() || '',
    amount: num(body.amount),
    currency: body.currency?.trim() || 'INR',
    expenseCategory: body.expenseCategory?.trim() || '',
    payeeName: body.payeeName?.trim() || '',
    expenseDate: body.expenseDate?.trim() || '',
    otherCategory: body.otherCategory?.trim() || '',
  };
}

function validateTypeDetails(requestType, details, body) {
  if (requestType === 'REPAIR' && !details.issueCategory) {
    throw new AppError('Issue category is required for Repair', 400, 'VALIDATION_ERROR');
  }
  if (requestType === 'MAINTENANCE' && !details.maintenanceKind) {
    throw new AppError('Maintenance kind is required', 400, 'VALIDATION_ERROR');
  }
  if (requestType === 'LOGISTICS' && !details.logisticsKind) {
    throw new AppError('Logistics kind is required', 400, 'VALIDATION_ERROR');
  }
  if (requestType === 'TRAINING' && !details.trainingTopic) {
    throw new AppError('Training topic is required', 400, 'VALIDATION_ERROR');
  }
  if (requestType === 'REIMBURSEMENT') {
    if (details.amount == null || details.amount <= 0) {
      throw new AppError('Amount is required for Reimbursement', 400, 'VALIDATION_ERROR');
    }
    if (!details.expenseCategory) {
      throw new AppError('Expense category is required', 400, 'VALIDATION_ERROR');
    }
  }
  if (requestType === 'OTHER' && !details.otherCategory) {
    throw new AppError('Category is required for Other requests', 400, 'VALIDATION_ERROR');
  }
  if (requestType === 'LOGISTICS' && !body.toContactId && !body.toCity) {
    // destination helpful but not hard-required if reason covers it
  }
}

async function notifyApprovers({ request, actorId, reason }) {
  const roles = await Role.find({ isDeleted: false });
  const roleById = new Map(roles.map((r) => [String(r._id), r]));

  const users = await User.find({ isDeleted: false, isActive: true });
  const approvers = users.filter((u) => {
    if (String(u._id) === String(actorId)) return false;
    const roleIds = (u.roleIds || []).map((id) => String(id?._id || id));
    return roleIds.some((rid) => {
      const role = roleById.get(rid);
      if (!role) return false;
      const perms = role.permissions || [];
      return (
        perms.includes(PERMISSIONS.ASSET_REQUESTS_APPROVE) ||
        perms.includes(PERMISSIONS.MOVEMENTS_APPROVE) ||
        role.name === 'Approver'
      );
    });
  });

  const label = typeLabel(request.requestType);
  const subject = request.assetName || request.trainingTopic || request.payeeName || 'Request';

  for (const a of approvers) {
    await Notification.create({
      userId: a._id,
      type: 'ASSET_REQUEST_APPROVAL',
      title: `${label} request ${request.requestNumber} needs approval`,
      body: reason || `${subject} · ${request.custodianName || '—'}`,
      entityType: 'AssetRequest',
      entityId: request._id,
    });
  }
}

function isLogistics(type) {
  return type === 'LOGISTICS' || type === 'MOVEMENT';
}

router.get(
  '/',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.requestType) {
      const t = normalizeRequestType(req.query.requestType);
      if (t === 'LOGISTICS') {
        filter.requestType = { $in: ['LOGISTICS', 'MOVEMENT'] };
      } else {
        filter.requestType = t;
      }
    }
    const [data, total] = await Promise.all([
      AssetRequest.find(filter)
        .populate('requestorId', 'fullName email')
        .populate('approverId', 'fullName email')
        .populate('assetId', 'assetTag deviceNameSnapshot serialNumber status custody')
        .populate('contactId', 'name contact city state')
        .sort(sort || '-createdAt')
        .skip(skip)
        .limit(limit),
      AssetRequest.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/export',
  canRead,
  asyncHandler(async (_req, res) => {
    const rows = await AssetRequest.find({ isDeleted: false })
      .populate('requestorId', 'fullName email')
      .populate('approverId', 'fullName email')
      .sort('-createdAt');
    sendExcel(
      res,
      'Request_Center.xlsx',
      [
        'Request Number',
        'Type',
        'Status',
        'Asset Name',
        'Custody',
        'Custodian Name',
        'Custodian Contact',
        'City',
        'State',
        'Priority',
        'Category / Kind',
        'Amount',
        'Currency',
        'Training Topic',
        'Reason',
        'Requestor',
        'Approver',
        'Created At',
      ],
      rows.map((r) => [
        r.requestNumber || r._id,
        typeLabel(r.requestType),
        r.status,
        r.assetName || '',
        r.assetCustody || '',
        r.custodianName || '',
        r.custodianContact || '',
        r.custodianCity || '',
        r.custodianState || '',
        r.priority || '',
        r.issueCategory ||
          r.maintenanceKind ||
          r.logisticsKind ||
          r.expenseCategory ||
          r.otherCategory ||
          '',
        r.amount ?? '',
        r.currency || '',
        r.trainingTopic || '',
        r.reason || '',
        r.requestorId?.fullName || r.requestorId?.email || '',
        r.approverId?.fullName || r.approverId?.email || '',
        r.createdAt,
      ]),
      { sheetName: 'The Request Center' }
    );
  })
);

router.get(
  '/:id',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await AssetRequest.findOne({ _id: req.params.id, isDeleted: false })
      .populate('requestorId', 'fullName email')
      .populate('approverId', 'fullName email')
      .populate('assetId')
      .populate('contactId', 'name contact city state');
    if (!row) throw new AppError('Request not found', 404);
    res.json({ data: row });
  })
);

router.post(
  '/',
  canRequest,
  asyncHandler(async (req, res) => {
    const rawType = String(req.body.requestType || '').toUpperCase();
    if (!ALL_REQUEST_TYPES.includes(rawType) && !ALL_REQUEST_TYPES.includes(normalizeRequestType(rawType))) {
      throw new AppError(
        'requestType must be Repair, Maintenance, Logistics, Training, Reimbursement, or Other',
        400,
        'VALIDATION_ERROR'
      );
    }
    const requestType = normalizeRequestType(rawType);
    const reason = String(req.body.reason || req.body.description || '').trim();
    if (!reason) throw new AppError('Reason / description is required', 400, 'VALIDATION_ERROR');

    const details = pickDetails(req.body);
    validateTypeDetails(requestType, details, req.body);

    const needsAsset = ASSET_REQUIRED_TYPES.includes(requestType);
    const assetId = req.body.assetId || null;

    if (needsAsset && !assetId) {
      throw new AppError('Asset is required for this request type', 400, 'VALIDATION_ERROR');
    }

    let linked = emptyLinkedSnapshot();
    let asset = null;
    if (assetId) {
      linked = await buildLinkedSnapshot(assetId);
      asset = await Asset.findOne({ _id: assetId, isDeleted: false });
    }

    if (isLogistics(requestType) && asset) {
      if (asset.openMovementId) {
        throw new AppError('Asset already has an open logistics / movement request', 400, 'ASSET_LOCKED');
      }
      if (['Repair', 'Disposed'].includes(asset.status)) {
        throw new AppError('Asset is not eligible for logistics transfer', 400, 'INVALID_STATUS');
      }
    }
    if (requestType === 'REPAIR' && asset?.openRepairId) {
      throw new AppError('Asset already has an open repair', 400, 'ASSET_LOCKED');
    }
    if (requestType === 'MAINTENANCE' && asset?.openMaintenanceId) {
      throw new AppError('Asset already has open maintenance', 400, 'ASSET_LOCKED');
    }

    const row = await AssetRequest.create({
      requestNumber: await nextSequence('assetRequestNumber', 'ARQ'),
      requestType,
      status: 'REQUESTED',
      requestorId: req.user._id,
      reason,
      assetId: linked.assetId,
      assetTag: linked.assetTag,
      serialNumber: linked.serialNumber,
      assetName: req.body.assetName?.trim() || linked.assetName,
      assetCustody: req.body.assetCustody?.trim() || linked.assetCustody,
      custodianState: req.body.custodianState?.trim() || linked.custodianState,
      custodianName: req.body.custodianName?.trim() || linked.custodianName,
      custodianContact: req.body.custodianContact?.trim() || linked.custodianContact,
      custodianCity: req.body.custodianCity?.trim() || linked.custodianCity,
      contactId: req.body.contactId || linked.contactId,
      fromStatus: linked.fromStatus,
      toContactId: req.body.toContactId || null,
      toCity: req.body.toCity?.trim() || '',
      ...details,
    });

    await notifyApprovers({ request: row, actorId: req.user._id, reason });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET_REQUEST.CREATE',
      entityType: 'AssetRequest',
      entityId: row._id,
      after: row.toObject?.() || row,
      requestId: req.requestId,
    });

    res.status(201).json({ data: row });
  })
);

router.post(
  '/:id/approve',
  canApprove,
  asyncHandler(async (req, res) => {
    const row = await AssetRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Request not found', 404);
    if (row.status !== 'REQUESTED') {
      throw new AppError('Only REQUESTED items can be approved', 400, 'INVALID_STATUS');
    }
    if (String(row.requestorId) === String(req.user._id)) {
      throw new AppError('Segregation of duties: requestor cannot approve', 403, 'SOD_VIOLATION');
    }

    const needsAsset = ASSET_REQUIRED_TYPES.includes(row.requestType) || row.requestType === 'MOVEMENT';
    let asset = null;
    if (row.assetId) {
      asset = await Asset.findOne({ _id: row.assetId, isDeleted: false });
      if (needsAsset && !asset) throw new AppError('Linked asset not found', 404);
    } else if (needsAsset) {
      throw new AppError('Linked asset not found', 404);
    }

    row.status = 'APPROVED';
    row.approverId = req.user._id;
    row.approvedAt = new Date().toISOString();
    await row.save();

    if (asset) {
      if (row.requestType === 'REPAIR') {
        asset.status = 'Repair';
        asset.openRepairId = row._id;
        await asset.save();
      } else if (row.requestType === 'MAINTENANCE') {
        asset.status = 'Maintenance';
        asset.openMaintenanceId = row._id;
        await asset.save();
      } else if (isLogistics(row.requestType)) {
        asset.openMovementId = row._id;
        if (row.toContactId) {
          const contact = await Contact.findOne({ _id: row.toContactId, isDeleted: false });
          if (contact) {
            asset.contactId = contact._id;
            asset.custodianName = contact.name || asset.custodianName;
            asset.custodianContact = contact.contact || contact.mobile || asset.custodianContact;
            asset.custodianCity = contact.city || asset.custodianCity;
            asset.custodianState = contact.state || asset.custodianState;
            asset.location = {
              ...(asset.location || {}),
              city: contact.city || asset.location?.city,
              state: contact.state || asset.location?.state,
            };
          }
        } else if (row.toCity) {
          asset.custodianCity = row.toCity;
          asset.location = { ...(asset.location || {}), city: row.toCity };
        }
        await asset.save();
      }
    }

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET_REQUEST.APPROVE',
      entityType: 'AssetRequest',
      entityId: row._id,
      requestId: req.requestId,
    });

    if (row.requestorId) {
      await Notification.create({
        userId: row.requestorId,
        type: 'ASSET_REQUEST_APPROVAL',
        title: `Request ${row.requestNumber} approved`,
        body: `${typeLabel(row.requestType)} · ${row.assetName || row.trainingTopic || ''}`.trim(),
        entityType: 'AssetRequest',
        entityId: row._id,
      });
    }

    res.json({ data: row });
  })
);

router.post(
  '/:id/reject',
  canApprove,
  asyncHandler(async (req, res) => {
    const row = await AssetRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Request not found', 404);
    if (row.status !== 'REQUESTED') {
      throw new AppError('Only REQUESTED items can be rejected', 400, 'INVALID_STATUS');
    }
    if (String(row.requestorId) === String(req.user._id)) {
      throw new AppError('Segregation of duties: requestor cannot reject', 403, 'SOD_VIOLATION');
    }

    row.status = 'REJECTED';
    row.approverId = req.user._id;
    row.rejectedAt = new Date().toISOString();
    row.rejectionReason = String(req.body.reason || req.body.rejectionReason || '').trim() || null;
    await row.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'ASSET_REQUEST.REJECT',
      entityType: 'AssetRequest',
      entityId: row._id,
      requestId: req.requestId,
    });

    if (row.requestorId) {
      await Notification.create({
        userId: row.requestorId,
        type: 'ASSET_REQUEST_APPROVAL',
        title: `Request ${row.requestNumber} rejected`,
        body: row.rejectionReason || `${typeLabel(row.requestType)} · ${row.assetName || ''}`.trim(),
        entityType: 'AssetRequest',
        entityId: row._id,
      });
    }

    res.json({ data: row });
  })
);

router.post(
  '/:id/complete',
  canApprove,
  asyncHandler(async (req, res) => {
    const row = await AssetRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Request not found', 404);
    if (row.status !== 'APPROVED') {
      throw new AppError('Only APPROVED items can be completed', 400, 'INVALID_STATUS');
    }

    const asset = row.assetId
      ? await Asset.findOne({ _id: row.assetId, isDeleted: false })
      : null;
    if (asset) {
      if (row.requestType === 'REPAIR' && String(asset.openRepairId) === String(row._id)) {
        asset.openRepairId = null;
        asset.status = req.body.returnToStatus || row.fromStatus || 'Warehouse';
        await asset.save();
      }
      if (row.requestType === 'MAINTENANCE' && String(asset.openMaintenanceId) === String(row._id)) {
        asset.openMaintenanceId = null;
        asset.status = req.body.returnToStatus || row.fromStatus || 'Available';
        await asset.save();
      }
      if (isLogistics(row.requestType) && String(asset.openMovementId) === String(row._id)) {
        asset.openMovementId = null;
        await asset.save();
      }
    }

    row.status = 'COMPLETED';
    row.completedAt = new Date().toISOString();
    await row.save();

    res.json({ data: row });
  })
);

export default router;
