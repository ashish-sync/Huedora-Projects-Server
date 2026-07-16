import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { writeAudit } from '../../utils/audit.js';
import {
  CAMP_METHODS,
  CAMP_PROCESS_MAP,
  CAMP_STATUSES,
  CAMP_SLOTS,
  resolveCampType,
  processesForMethod,
  resolveCampSlot,
} from './camp.constants.js';
import { CampRequest } from './camp.model.js';

const router = Router();
router.use(authenticate);

const canRead = requirePermission(
  PERMISSIONS.CAMPS_READ,
  PERMISSIONS.CAMPS_REQUEST,
  PERMISSIONS.CAMPS_APPROVE
);
const canRequest = requirePermission(PERMISSIONS.CAMPS_REQUEST, PERMISSIONS.CAMPS_APPROVE);
const canApprove = requirePermission(PERMISSIONS.CAMPS_APPROVE);

function trimStr(v) {
  return v == null ? '' : String(v).trim();
}

function canSeeAll(req) {
  return req.permissions.has(PERMISSIONS.ALL) || req.permissions.has(PERMISSIONS.CAMPS_APPROVE);
}

function nextRequestKey() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CAMP-${stamp}-${rand}`;
}

function normalizeRequestBody(body, existing = null) {
  const method = trimStr(body.method ?? existing?.method ?? '');
  const process = trimStr(body.process ?? existing?.process ?? '');
  if (!CAMP_METHODS.includes(method)) {
    throw new AppError(`Method must be one of: ${CAMP_METHODS.join(', ')}`, 400, 'VALIDATION_ERROR');
  }
  const allowed = processesForMethod(method);
  if (!allowed.includes(process)) {
    throw new AppError(
      `Process “${process}” is not valid for method “${method}”`,
      400,
      'VALIDATION_ERROR'
    );
  }
  const campType = resolveCampType(method, process);
  if (!campType) {
    throw new AppError('Unable to resolve Camp Type for Method/Process', 400, 'VALIDATION_ERROR');
  }

  const startTime = trimStr(body.startTime ?? existing?.startTime ?? '');
  const endTime = trimStr(body.endTime ?? existing?.endTime ?? '');
  const campSlot = resolveCampSlot(startTime);
  if (!campSlot) {
    throw new AppError(
      'Start Time must be between 6:00 AM and 10:00 PM to derive Camp Slot',
      400,
      'VALIDATION_ERROR'
    );
  }

  const campDate = trimStr(body.campDate ?? existing?.campDate ?? '');
  if (!campDate) throw new AppError('Camp Date is required', 400, 'VALIDATION_ERROR');

  // Must be at least 2 calendar days ahead (e.g. if today is 15th, earliest is 17th)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDate = new Date(today);
  minDate.setDate(minDate.getDate() + 2);
  const camp = new Date(`${campDate}T00:00:00`);
  if (Number.isNaN(camp.getTime()) || camp < minDate) {
    const minStr = minDate.toISOString().slice(0, 10);
    throw new AppError(
      `Camp Date must be on or after ${minStr}`,
      400,
      'VALIDATION_ERROR'
    );
  }

  const doctorName = trimStr(body.doctorName ?? existing?.doctorName ?? '');
  if (!doctorName) throw new AppError('Doctor Name is required', 400, 'VALIDATION_ERROR');

  if (startTime && endTime) {
    const toMins = (t) => {
      const m = String(t).match(/^(\d{1,2}):(\d{2})/);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const a = toMins(startTime);
    const b = toMins(endTime);
    if (a != null && b != null && b <= a) {
      throw new AppError('End Time must be after Start Time', 400, 'VALIDATION_ERROR');
    }
  }

  return {
    method,
    process,
    campType,
    doctorName,
    address: trimStr(body.address ?? existing?.address ?? ''),
    city: trimStr(body.city ?? existing?.city ?? ''),
    state: trimStr(body.state ?? existing?.state ?? ''),
    campDate,
    startTime,
    endTime,
    campSlot,
    /** Technician / HCW is assigned by approver on Approve — not on request create */
    technicianName: trimStr(body.technicianName ?? existing?.technicianName ?? ''),
    technicianNumber: trimStr(body.technicianNumber ?? existing?.technicianNumber ?? ''),
    technicianContactId: body.technicianContactId || existing?.technicianContactId || null,
    remarks: trimStr(body.remarks ?? existing?.remarks ?? ''),
  };
}

router.get(
  '/meta',
  canRead,
  asyncHandler(async (_req, res) => {
    res.json({
      data: {
        methods: CAMP_METHODS,
        processMap: CAMP_PROCESS_MAP,
        statuses: CAMP_STATUSES,
        slots: CAMP_SLOTS,
      },
    });
  })
);

router.get(
  '/',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (!canSeeAll(req)) {
      filter.requesterId = req.user._id;
    } else if (req.query.mine === '1') {
      filter.requesterId = req.user._id;
    }
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.method) filter.method = String(req.query.method);
    if (req.query.campSlot) filter.campSlot = String(req.query.campSlot);
    if (req.query.q) {
      const re = new RegExp(String(req.query.q), 'i');
      filter.$or = [
        { requestKey: re },
        { doctorName: re },
        { technicianName: re },
        { city: re },
        { state: re },
        { process: re },
        { requesterEmail: re },
      ];
    }
    const [data, total] = await Promise.all([
      CampRequest.find(filter).sort(sort || '-requestedAt').skip(skip).limit(limit),
      CampRequest.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/:id',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await CampRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Camp request not found', 404);
    if (!canSeeAll(req) && String(row.requesterId) !== String(req.user._id)) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }
    res.json({ data: row });
  })
);

router.post(
  '/',
  canRequest,
  asyncHandler(async (req, res) => {
    const fields = normalizeRequestBody(req.body);
    const row = await CampRequest.create({
      ...fields,
      requestKey: nextRequestKey(),
      status: 'Pending',
      decisionReason: '',
      decidedAt: null,
      decidedById: null,
      decidedByEmail: '',
      requestedAt: new Date().toISOString(),
      requesterId: req.user._id,
      requesterEmail: req.user.email || '',
      requesterName: req.user.fullName || req.user.username || req.user.email || '',
      isActive: true,
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'CampRequest.CREATE',
      entityType: 'CampRequest',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.status(201).json({ data: row });
  })
);

router.patch(
  '/:id',
  canRequest,
  asyncHandler(async (req, res) => {
    const row = await CampRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Camp request not found', 404);
    if (String(row.requesterId) !== String(req.user._id) && !canSeeAll(req)) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }
    if (row.status !== 'Pending') {
      throw new AppError('Only Pending requests can be edited', 400, 'LOCKED');
    }
    const fields = normalizeRequestBody(req.body, row);
    Object.assign(row, fields);
    await row.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'CampRequest.UPDATE',
      entityType: 'CampRequest',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.json({ data: row });
  })
);

router.post(
  '/:id/decide',
  canApprove,
  asyncHandler(async (req, res) => {
    const row = await CampRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Camp request not found', 404);
    if (row.status !== 'Pending') {
      throw new AppError('Request already decided', 400, 'LOCKED');
    }

    const decision = trimStr(req.body.decision || req.body.status).toLowerCase();
    let status;
    if (decision === 'approve' || decision === 'approved') status = 'Approved';
    else if (decision === 'decline' || decision === 'declined' || decision === 'reject') {
      status = 'Declined';
    } else {
      throw new AppError('decision must be Approve or Decline', 400, 'VALIDATION_ERROR');
    }

    const reason = trimStr(req.body.reason || req.body.decisionReason);

    if (status === 'Declined') {
      if (!reason) {
        throw new AppError('Reason is mandatory when declining', 400, 'VALIDATION_ERROR');
      }
      row.status = status;
      row.decisionReason = reason;
    } else {
      const technicianName = trimStr(req.body.technicianName || req.body.hcwName);
      const technicianNumber = trimStr(req.body.technicianNumber || req.body.hcwNumber);
      if (!technicianName) {
        throw new AppError('Technician Name (HCW Name) is required to approve', 400, 'VALIDATION_ERROR');
      }
      if (!technicianNumber) {
        throw new AppError('Technician Number is required to approve', 400, 'VALIDATION_ERROR');
      }
      row.status = status;
      row.technicianName = technicianName;
      row.technicianNumber = technicianNumber;
      row.technicianContactId = req.body.technicianContactId || row.technicianContactId || null;
      row.decisionReason = reason || 'Approved';
    }

    row.decidedAt = new Date().toISOString();
    row.decidedById = req.user._id;
    row.decidedByEmail = req.user.email || '';
    await row.save();

    if (status === 'Approved') {
      try {
        const { syncUsageFromCamps } = await import('../logistics/logistics.usage.js');
        await syncUsageFromCamps();
      } catch {
        /* non-blocking */
      }
    }

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: `CampRequest.${status.toUpperCase()}`,
      entityType: 'CampRequest',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.json({ data: row });
  })
);

router.delete(
  '/:id',
  canRequest,
  asyncHandler(async (req, res) => {
    const row = await CampRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Camp request not found', 404);
    if (String(row.requesterId) !== String(req.user._id) && !canSeeAll(req)) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }
    if (row.status !== 'Pending' && !canSeeAll(req)) {
      throw new AppError('Only Pending requests can be withdrawn', 400, 'LOCKED');
    }
    row.isDeleted = true;
    row.isActive = false;
    await row.save();
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'CampRequest.DELETE',
      entityType: 'CampRequest',
      entityId: row._id,
      requestId: req.requestId,
    });
    res.json({ data: { ok: true } });
  })
);

export default router;
