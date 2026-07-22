import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { Movement } from './movement.model.js';
import { Asset } from '../assets/asset.model.js';
import { AssetEvent } from '../assets/assetEvent.model.js';
import { Contact } from '../contacts/contact.model.js';
import { nextSequence } from '../../utils/counters.js';
import { writeAudit } from '../../utils/audit.js';
import { Notification } from '../notifications/notification.model.js';
import { User } from '../users/user.model.js';
import { Role } from '../users/role.model.js';
import { sendExcel } from '../../utils/excelExport.js';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.status) filter.status = req.query.status;
    const [data, total] = await Promise.all([
      Movement.find(filter)
        .populate('requestorId', 'fullName email')
        .populate('approverId', 'fullName email')
        .populate('to.contactId', 'name email contact city')
        .populate('to.hcwId', 'hcwId name')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Movement.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/export',
  asyncHandler(async (_req, res) => {
    const rows = await Movement.find({ isDeleted: false })
      .populate('requestorId', 'fullName email')
      .populate('approverId', 'fullName email')
      .populate('to.contactId', 'name email contact city')
      .sort('-createdAt');
    sendExcel(
      res,
      'Movements.xlsx',
      [
        'Movement Number',
        'Status',
        'Reason',
        'Requestor',
        'Approver',
        'To Custodian',
        'City',
        'Created At',
      ],
      rows.map((m) => [
        m.movementNumber || m._id,
        m.status,
        m.reason,
        m.requestorId?.fullName || m.requestorId?.email || '',
        m.approverId?.fullName || m.approverId?.email || '',
        m.to?.contactId?.name || m.to?.hcwId?.name || '',
        m.to?.contactId?.city || m.to?.location?.city || '',
        m.createdAt,
      ]),
      { sheetName: 'Movements' }
    );
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const movement = await Movement.findOne({ _id: req.params.id, isDeleted: false })
      .populate('requestorId', 'fullName email')
      .populate('approverId', 'fullName email')
      .populate('assets.assetId');
    if (!movement) throw new AppError('Movement not found', 404);
    res.json({ data: movement });
  })
);

router.post(
  '/',
  requirePermission(PERMISSIONS.MOVEMENTS_REQUEST),
  asyncHandler(async (req, res) => {
    const { assetIds, reason, to, from, idempotencyKey } = req.body;
    if (!assetIds?.length || !reason) {
      throw new AppError('assetIds and reason required', 400, 'VALIDATION_ERROR');
    }
    if (idempotencyKey) {
      const existing = await Movement.findOne({ idempotencyKey });
      if (existing) return res.status(200).json({ data: existing });
    }

    const assets = [];
    for (const assetId of assetIds) {
      const asset = await Asset.findOne({ _id: assetId, isDeleted: false });
      if (!asset) throw new AppError(`Asset ${assetId} not found`, 404);
      if (asset.openMovementId) {
        throw new AppError(`Asset ${asset.assetTag} already in transit`, 400, 'ASSET_LOCKED');
      }
      if (['Repair', 'Disposed'].includes(asset.status)) {
        throw new AppError(`Asset ${asset.assetTag} not eligible for movement`, 400, 'INVALID_STATUS');
      }
      assets.push({ assetId: asset._id, serialNumber: asset.serialNumber, fromStatus: asset.status });
    }

    const movement = await Movement.create({
      movementNumber: await nextSequence('movementNumber', 'MOV'),
      requestorId: req.user._id,
      reason,
      from: from || {},
      to: to || {},
      assets,
      idempotencyKey,
      status: 'REQUESTED',
    });

    const approverRole = await Role.findOne({ name: 'Approver' });
    if (approverRole) {
      const approvers = await User.find({
        roleIds: approverRole._id,
        isDeleted: false,
        isActive: true,
        _id: { $ne: req.user._id },
      });
      for (const a of approvers) {
        await Notification.create({
          userId: a._id,
          type: 'MOVEMENT_APPROVAL',
          title: `Movement ${movement.movementNumber} needs approval`,
          body: reason,
          entityType: 'Movement',
          entityId: movement._id,
        });
      }
    }

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'MOVEMENT.REQUEST',
      entityType: 'Movement',
      entityId: movement._id,
      after: movement.toObject(),
      requestId: req.requestId,
    });

    res.status(201).json({ data: movement });
  })
);

router.post(
  '/:id/approve',
  requirePermission(PERMISSIONS.MOVEMENTS_APPROVE),
  asyncHandler(async (req, res) => {
    const movement = await Movement.findOne({ _id: req.params.id, isDeleted: false });
    if (!movement) throw new AppError('Movement not found', 404);
    if (movement.status !== 'REQUESTED') {
      throw new AppError('Only REQUESTED movements can be approved', 400, 'INVALID_STATUS');
    }
    if (String(movement.requestorId) === String(req.user._id)) {
      throw new AppError('Segregation of duties: requestor cannot approve', 403, 'SOD_VIOLATION');
    }
    movement.status = 'APPROVED';
    movement.approverId = req.user._id;
    movement.approvedAt = new Date();
    await movement.save();
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'MOVEMENT.APPROVE',
      entityType: 'Movement',
      entityId: movement._id,
      requestId: req.requestId,
    });
    await Notification.create({
      userId: movement.requestorId,
      type: 'MOVEMENT_APPROVAL',
      title: `Movement ${movement.movementNumber} approved`,
      entityType: 'Movement',
      entityId: movement._id,
    });
    res.json({ data: movement });
  })
);

router.post(
  '/:id/reject',
  requirePermission(PERMISSIONS.MOVEMENTS_APPROVE),
  asyncHandler(async (req, res) => {
    const movement = await Movement.findOne({ _id: req.params.id, isDeleted: false });
    if (!movement) throw new AppError('Movement not found', 404);
    if (String(movement.requestorId) === String(req.user._id)) {
      throw new AppError('Segregation of duties: requestor cannot reject', 403, 'SOD_VIOLATION');
    }
    movement.status = 'REJECTED';
    movement.approverId = req.user._id;
    movement.rejectedAt = new Date();
    movement.rejectionReason = req.body.reason || '';
    await movement.save();
    res.json({ data: movement });
  })
);

router.post(
  '/:id/ship',
  requirePermission(PERMISSIONS.MOVEMENTS_REQUEST),
  asyncHandler(async (req, res) => {
    const movement = await Movement.findOne({ _id: req.params.id, isDeleted: false });
    if (!movement) throw new AppError('Movement not found', 404);
    if (movement.status !== 'APPROVED') throw new AppError('Must be APPROVED', 400);
    movement.status = 'IN_TRANSIT';
    movement.shippedAt = new Date();
    await movement.save();
    for (const item of movement.assets) {
      await Asset.updateOne({ _id: item.assetId }, { $set: { openMovementId: movement._id } });
    }
    res.json({ data: movement });
  })
);

router.post(
  '/:id/receive',
  requirePermission(PERMISSIONS.MOVEMENTS_REQUEST),
  asyncHandler(async (req, res) => {
    const movement = await Movement.findOne({ _id: req.params.id, isDeleted: false });
    if (!movement) throw new AppError('Movement not found', 404);
    if (movement.status !== 'IN_TRANSIT') throw new AppError('Must be IN_TRANSIT', 400);

    let toContact = null;
    if (movement.to?.contactId) {
      toContact = await Contact.findById(movement.to.contactId);
    } else if (movement.to?.hcwId) {
      // Legacy movements that still store to.hcwId. leave without remapping on receive
      toContact = null;
    }

    for (const item of movement.assets) {
      const asset = await Asset.findById(item.assetId);
      if (!asset) continue;
      const fromContactId = asset.contactId;
      const fromLocation = asset.location;
      if (toContact) {
        asset.contactId = toContact._id;
        asset.hcwId = null;
        asset.hcwBusinessId = null;
        if (!['Assigned', 'Verified'].includes(asset.status)) asset.status = 'Assigned';
        if (toContact.city) {
          asset.location = { ...(asset.location || {}), city: toContact.city };
        }
      }
      if (movement.to?.location) {
        asset.location = { ...(asset.location || {}), ...movement.to.location };
      }
      asset.openMovementId = null;
      await asset.save();
      await AssetEvent.create({
        assetId: asset._id,
        eventType: 'CUSTODY_CHANGE',
        fromContactId,
        toContactId: asset.contactId,
        fromLocation,
        toLocation: asset.location,
        relatedEntityType: 'Movement',
        relatedEntityId: movement._id,
        actorId: req.user._id,
        reason: `Received ${movement.movementNumber}`,
      });
    }

    movement.status = 'RECEIVED';
    movement.receivedAt = new Date();
    movement.receivedByUserId = req.user._id;
    await movement.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'MOVEMENT.RECEIVE',
      entityType: 'Movement',
      entityId: movement._id,
      requestId: req.requestId,
    });

    res.json({ data: movement });
  })
);

router.post(
  '/:id/cancel',
  requirePermission(PERMISSIONS.MOVEMENTS_REQUEST),
  asyncHandler(async (req, res) => {
    const movement = await Movement.findOne({ _id: req.params.id, isDeleted: false });
    if (!movement) throw new AppError('Movement not found', 404);
    if (['RECEIVED', 'CANCELLED'].includes(movement.status)) {
      throw new AppError('Cannot cancel', 400);
    }
    for (const item of movement.assets) {
      await Asset.updateOne(
        { _id: item.assetId, openMovementId: movement._id },
        { $set: { openMovementId: null } }
      );
    }
    movement.status = 'CANCELLED';
    await movement.save();
    res.json({ data: movement });
  })
);

export default router;
