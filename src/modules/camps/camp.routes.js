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
  CAMP_DURATION_OPTIONS,
  CAMP_CANCEL_SOURCES,
  resolveCampType,
  processesForMethod,
  resolveCampSlot,
  resolveCampSchedule,
  isCampScheduleOverdue,
  canTransitionCamp,
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

function enrichCamp(row) {
  const obj = row.toObject ? row.toObject() : { ...row };
  obj.isScheduleOverdue = isCampScheduleOverdue(obj);
  return obj;
}

function normalizeRequestBody(body, existing = null, { relaxDate = false } = {}) {
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

  const rawDuration = body.durationHours ?? existing?.durationHours ?? 3;
  const durationHours = Number(rawDuration) || 3;
  if (!CAMP_DURATION_OPTIONS.includes(durationHours) && (durationHours < 1 || durationHours > 12)) {
    throw new AppError(
      `Duration must be one of: ${CAMP_DURATION_OPTIONS.join(', ')} hours`,
      400,
      'VALIDATION_ERROR'
    );
  }

  const schedule = resolveCampSchedule({
    startTime: body.startTime ?? existing?.startTime ?? '09:00',
    endTime: body.endTime ?? existing?.endTime ?? '',
    durationHours,
  });

  const startTime = schedule.startTime;
  const endTime = schedule.endTime;
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

  if (!relaxDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const minDate = new Date(today);
    minDate.setDate(minDate.getDate() + 2);
    const camp = new Date(`${campDate}T00:00:00`);
    if (Number.isNaN(camp.getTime()) || camp < minDate) {
      const minStr = minDate.toISOString().slice(0, 10);
      throw new AppError(`Camp Date must be on or after ${minStr}`, 400, 'VALIDATION_ERROR');
    }
  }

  const doctorName = trimStr(body.doctorName ?? existing?.doctorName ?? '');
  if (!doctorName) throw new AppError('Doctor Name is required', 400, 'VALIDATION_ERROR');

  const a = schedule.startTime;
  const b = schedule.endTime;
  if (a && b) {
    const toMins = (t) => {
      const m = String(t).match(/^(\d{1,2}):(\d{2})/);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const sa = toMins(a);
    const sb = toMins(b);
    if (sa != null && sb != null && sb <= sa) {
      throw new AppError('End Time must be after Start Time', 400, 'VALIDATION_ERROR');
    }
  }

  const expectedPatients = Math.max(
    0,
    Number(body.expectedPatients ?? existing?.expectedPatients ?? 0) || 0
  );

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
    durationHours: schedule.durationHours,
    expectedPatients,
    fieldPersonName: trimStr(body.fieldPersonName ?? existing?.fieldPersonName ?? ''),
    fieldPersonPhone: trimStr(body.fieldPersonPhone ?? existing?.fieldPersonPhone ?? ''),
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
        durationOptions: CAMP_DURATION_OPTIONS,
        cancelSources: CAMP_CANCEL_SOURCES,
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
        { fieldPersonName: re },
      ];
    }
    let [data, total] = await Promise.all([
      CampRequest.find(filter).sort(sort || '-requestedAt').skip(skip).limit(limit),
      CampRequest.countDocuments(filter),
    ]);
    data = data.map(enrichCamp);
    if (req.query.overdue === '1') {
      data = data.filter((r) => r.isScheduleOverdue);
      total = data.length;
    }
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
    res.json({ data: enrichCamp(row) });
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
      cancelledBy: '',
      cancelledAt: null,
      completedAt: null,
      completedById: null,
      completedByEmail: '',
      actualPatients: 0,
      screenCount: 0,
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

    res.status(201).json({ data: enrichCamp(row) });
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
    if (row.status !== 'Pending' && !(canSeeAll(req) && row.status === 'Approved')) {
      throw new AppError('Only Pending requests can be edited (approvers may adjust Approved)', 400, 'LOCKED');
    }
    const fields = normalizeRequestBody(req.body, row, {
      relaxDate: row.status === 'Approved',
    });
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

    res.json({ data: enrichCamp(row) });
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

    if (!canTransitionCamp('Pending', status)) {
      throw new AppError('Invalid status transition', 400, 'VALIDATION_ERROR');
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

    res.json({ data: enrichCamp(row) });
  })
);

/** Mark approved camp as Completed (executed) — capture actual patients / screens */
router.post(
  '/:id/complete',
  canApprove,
  asyncHandler(async (req, res) => {
    const row = await CampRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Camp request not found', 404);
    if (!canTransitionCamp(row.status, 'Completed')) {
      throw new AppError('Only Approved camps can be marked Completed', 400, 'LOCKED');
    }

    const actualPatients = Math.max(0, Number(req.body.actualPatients ?? 0) || 0);
    const screenCount = Math.max(
      0,
      Number(req.body.screenCount ?? req.body.actualPatients ?? row.expectedPatients ?? 0) || 0
    );

    row.status = 'Completed';
    row.actualPatients = actualPatients || screenCount;
    row.screenCount = screenCount || actualPatients;
    row.completedAt = new Date().toISOString();
    row.completedById = req.user._id;
    row.completedByEmail = req.user.email || '';
    if (trimStr(req.body.remarks)) {
      row.remarks = [row.remarks, trimStr(req.body.remarks)].filter(Boolean).join(' · ');
    }
    await row.save();

    try {
      const { syncUsageFromCamps } = await import('../logistics/logistics.usage.js');
      await syncUsageFromCamps();
    } catch {
      /* non-blocking */
    }

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'CampRequest.COMPLETED',
      entityType: 'CampRequest',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.json({ data: enrichCamp(row) });
  })
);

/** Cancel an approved camp (Brand or Ops + remark) */
router.post(
  '/:id/cancel',
  canApprove,
  asyncHandler(async (req, res) => {
    const row = await CampRequest.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Camp request not found', 404);
    if (!canTransitionCamp(row.status, 'Cancelled')) {
      throw new AppError('Only Approved camps can be cancelled', 400, 'LOCKED');
    }

    const cancelledBy = trimStr(req.body.cancelledBy);
    const remarks = trimStr(req.body.remarks || req.body.reason);
    if (!CAMP_CANCEL_SOURCES.includes(cancelledBy)) {
      throw new AppError(
        `cancelledBy must be one of: ${CAMP_CANCEL_SOURCES.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      );
    }
    if (!remarks) {
      throw new AppError('Remarks are required when cancelling', 400, 'VALIDATION_ERROR');
    }

    row.status = 'Cancelled';
    row.cancelledBy = cancelledBy;
    row.cancelledAt = new Date().toISOString();
    row.decisionReason = `Cancelled by ${cancelledBy}: ${remarks}`;
    row.remarks = [row.remarks, remarks].filter(Boolean).join(' · ');
    await row.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'CampRequest.CANCELLED',
      entityType: 'CampRequest',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.json({ data: enrichCamp(row) });
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
    if (row.status === 'Completed' && !req.permissions.has(PERMISSIONS.ALL)) {
      throw new AppError('Completed camps cannot be deleted', 400, 'LOCKED');
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
