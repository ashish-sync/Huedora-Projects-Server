import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { RepairTicket, MaintenanceOrder } from './repair.model.js';
import { nextSequence } from '../../utils/counters.js';
import { transitionAsset } from '../assets/asset.service.js';
import { Asset } from '../assets/asset.model.js';
import { writeAudit } from '../../utils/audit.js';
import { sendExcel } from '../../utils/excelExport.js';

/** Mounted at /api/v1/repairs. do not mount under /api/v1 catch-all. */
export const repairRoutes = Router();
repairRoutes.use(authenticate);

repairRoutes.get(
  '/export',
  asyncHandler(async (_req, res) => {
    const rows = await RepairTicket.find({ isDeleted: false })
      .populate('assetId', 'assetTag serialNumber deviceNameSnapshot')
      .sort('-createdAt');
    sendExcel(
      res,
      'Repairs.xlsx',
      [
        'Ticket Number',
        'Status',
        'Priority',
        'Asset Tag',
        'Serial Number',
        'Asset Name',
        'Fault Description',
        'Created At',
      ],
      rows.map((t) => [
        t.ticketNumber,
        t.status,
        t.priority,
        t.assetId?.assetTag || '',
        t.assetId?.serialNumber || '',
        t.assetId?.deviceNameSnapshot || '',
        t.faultDescription,
        t.createdAt,
      ]),
      { sheetName: 'Repairs' }
    );
  })
);

repairRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.status) filter.status = req.query.status;
    const [data, total] = await Promise.all([
      RepairTicket.find(filter).populate('assetId', 'assetTag serialNumber status').sort(sort).skip(skip).limit(limit),
      RepairTicket.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

repairRoutes.post(
  '/',
  requirePermission(PERMISSIONS.REPAIRS_WRITE),
  asyncHandler(async (req, res) => {
    if (!req.body.assetId || !req.body.faultDescription) {
      throw new AppError('assetId and faultDescription required', 400, 'VALIDATION_ERROR');
    }
    const ticket = await RepairTicket.create({
      ...req.body,
      ticketNumber: await nextSequence('repairTicket', 'REP'),
      reportedByUserId: req.user._id,
      status: 'OPEN',
    });
    await transitionAsset({
      assetId: req.body.assetId,
      toStatus: 'Repair',
      reason: `Repair ${ticket.ticketNumber}`,
      actor: req.user,
      requestId: req.requestId,
      relatedEntityType: 'RepairTicket',
      relatedEntityId: ticket._id,
    });
    await Asset.updateOne({ _id: req.body.assetId }, { $set: { openRepairId: ticket._id } });
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'REPAIR.OPEN',
      entityType: 'RepairTicket',
      entityId: ticket._id,
      requestId: req.requestId,
    });
    res.status(201).json({ data: ticket });
  })
);

repairRoutes.post(
  '/:id/status',
  requirePermission(PERMISSIONS.REPAIRS_WRITE),
  asyncHandler(async (req, res) => {
    const ticket = await RepairTicket.findOne({ _id: req.params.id, isDeleted: false });
    if (!ticket) throw new AppError('Ticket not found', 404);
    ticket.status = req.body.status || ticket.status;
    if (req.body.disposition) ticket.disposition = req.body.disposition;
    if (req.body.cost !== undefined) ticket.cost = req.body.cost;
    if (req.body.vendorName !== undefined) ticket.vendorName = req.body.vendorName;
    if (req.body.returnToStatus) ticket.returnToStatus = req.body.returnToStatus;

    if (['CLOSED', 'SCRAP_RECOMMENDED'].includes(ticket.status)) {
      ticket.closedAt = new Date();
      const returnTo =
        ticket.returnToStatus ||
        (ticket.disposition === 'IRREPARABLE' ? 'Retired' : 'Warehouse');
      await transitionAsset({
        assetId: ticket.assetId,
        toStatus: returnTo,
        reason: `Repair closed ${ticket.ticketNumber}`,
        actor: req.user,
        requestId: req.requestId,
        relatedEntityType: 'RepairTicket',
        relatedEntityId: ticket._id,
      });
      await Asset.updateOne({ _id: ticket.assetId }, { $set: { openRepairId: null } });
    }
    await ticket.save();
    res.json({ data: ticket });
  })
);

/** Mounted at /api/v1/maintenance. do not mount under /api/v1 catch-all. */
export const maintenanceRoutes = Router();
maintenanceRoutes.use(authenticate);

maintenanceRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.status) filter.status = req.query.status;
    const [data, total] = await Promise.all([
      MaintenanceOrder.find(filter)
        .populate('assetId', 'assetTag serialNumber status')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      MaintenanceOrder.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

maintenanceRoutes.post(
  '/',
  requirePermission(PERMISSIONS.MAINTENANCE_WRITE),
  asyncHandler(async (req, res) => {
    if (!req.body.assetId) throw new AppError('assetId required', 400, 'VALIDATION_ERROR');
    const order = await MaintenanceOrder.create({
      ...req.body,
      orderNumber: await nextSequence('maintenanceOrder', 'MNT'),
      status: req.body.status || 'IN_PROGRESS',
    });
    await transitionAsset({
      assetId: req.body.assetId,
      toStatus: 'Maintenance',
      reason: `Maintenance ${order.orderNumber}`,
      actor: req.user,
      requestId: req.requestId,
      relatedEntityType: 'MaintenanceOrder',
      relatedEntityId: order._id,
    });
    await Asset.updateOne({ _id: req.body.assetId }, { $set: { openMaintenanceId: order._id } });
    res.status(201).json({ data: order });
  })
);

maintenanceRoutes.post(
  '/:id/status',
  requirePermission(PERMISSIONS.MAINTENANCE_WRITE),
  asyncHandler(async (req, res) => {
    const order = await MaintenanceOrder.findOne({ _id: req.params.id, isDeleted: false });
    if (!order) throw new AppError('Order not found', 404);
    order.status = req.body.status || order.status;
    if (req.body.returnToStatus) order.returnToStatus = req.body.returnToStatus;
    if (order.status === 'COMPLETED') {
      order.completedAt = new Date();
      const returnTo = order.returnToStatus || 'Available';
      await transitionAsset({
        assetId: order.assetId,
        toStatus: returnTo,
        reason: `Maintenance completed ${order.orderNumber}`,
        actor: req.user,
        requestId: req.requestId,
        relatedEntityType: 'MaintenanceOrder',
        relatedEntityId: order._id,
      });
      await Asset.updateOne({ _id: order.assetId }, { $set: { openMaintenanceId: null } });
    }
    await order.save();
    res.json({ data: order });
  })
);
