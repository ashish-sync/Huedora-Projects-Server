import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { writeAudit } from '../../utils/audit.js';
import { sendExcel } from '../../utils/excelExport.js';
import { formatDate } from '../../utils/dateFormat.js';
import { cellValue, excelUpload, parseSheetRows } from '../../utils/masterExcel.js';
import { User } from '../users/user.model.js';
import {
  CAMP_OPS_STATUSES,
  CAMP_OPS_SOURCES,
  CAMP_OPS_CANCEL_SOURCES,
  CAMP_OPS_DURATION_OPTIONS,
  CAMP_NAME_OPTIONS,
  CAMP_IMPORT_FIELDS,
  STANDARD_IMPORT_MAPPING,
  CAMP_OPS_ROLE_CATALOG,
  canTransition,
  isCampEditable,
  normalizeCampName,
} from './campOps.constants.js';
import {
  CampOpsCamp,
  CampOpsClient,
  CampOpsClientMaster,
  CampOpsCampaign,
  CampOpsImportTemplate,
} from './campOps.model.js';
import {
  trimStr,
  escapeRegex,
  resolveCampSchedule,
  parseLocalDateInput,
  withCampSchedule,
  isCampOverdue,
  buildCampFilter,
  generateCampId,
  captureSubmissionTracking,
  buildClientCode,
  groupCount,
  mapImportRows,
  validateMappedImportRows,
} from './campOps.helpers.js';
import {
  extractManualPastePreview,
  processManualPaste,
} from './manualPaste.service.js';

const router = Router();
router.use(authenticate);

const canRead = requirePermission(
  PERMISSIONS.CAMPS_READ,
  PERMISSIONS.CAMPS_REQUEST,
  PERMISSIONS.CAMPS_APPROVE
);
const canRequest = requirePermission(PERMISSIONS.CAMPS_REQUEST, PERMISSIONS.CAMPS_APPROVE);
const canApprove = requirePermission(PERMISSIONS.CAMPS_APPROVE);

function actor(req) {
  return {
    id: req.user?._id || null,
    email: req.user?.email || '',
  };
}

async function audit(req, action, entityType, entityId, before = null, after = null) {
  const a = actor(req);
  await writeAudit({
    actorId: a.id,
    actorEmail: a.email,
    action,
    entityType,
    entityId,
    before,
    after,
    ip: req.ip,
    requestId: req.correlationId,
  });
}

async function ensureUniqueClientCode(baseCode) {
  let code = baseCode;
  let suffix = 1;
  while (await CampOpsClient.findOne({ isDeleted: false, code })) {
    code = `${baseCode}${suffix}`;
    suffix += 1;
  }
  return code;
}

async function resolveClientFromBody(body, { allowCreate = false } = {}) {
  const clientId = body.clientId || body.client;
  if (clientId) {
    const byId = await CampOpsClient.findOne({ _id: String(clientId), isDeleted: false });
    if (byId) return byId;
  }
  const name = trimStr(body.clientName);
  if (!name) return null;
  const existing = await CampOpsClient.findOne({ isDeleted: false, name });
  if (existing) return existing;
  if (!allowCreate) return null;
  const requestedCode = trimStr(body.clientCode).toUpperCase();
  const code = requestedCode || (await ensureUniqueClientCode(buildClientCode(name)));
  return CampOpsClient.create({ name, code, isActive: true });
}

function campPayloadFromBody(body, existing = null, client = null) {
  const schedule = resolveCampSchedule({
    startTime: body.startTime ?? existing?.startTime ?? '09:00',
    endTime: body.endTime ?? existing?.endTime ?? '',
    durationHours: body.durationHours ?? existing?.durationHours ?? 3,
  });

  const campDateRaw = body.campDate ?? existing?.campDate;
  const campDate = parseLocalDateInput(campDateRaw) || trimStr(campDateRaw);
  if (!campDate && !existing) {
    throw new AppError('Camp date is required', 400, 'VALIDATION_ERROR');
  }

  const hospitalName = trimStr(
    body.hospitalName ?? body.clinicName ?? existing?.hospitalName ?? ''
  );

  return {
    clientId: client?._id ?? existing?.clientId ?? null,
    clientName:
      client?.name || trimStr(body.clientName) || existing?.clientName || '',
    campaignId:
      body.campaignId !== undefined
        ? body.campaignId || null
        : existing?.campaignId ?? null,
    campaignName: normalizeCampName(
      body.campaignName ?? existing?.campaignName ?? 'BMD'
    ),
    campaignType: trimStr(body.campaignType ?? existing?.campaignType) || 'Screening',
    doctorName: trimStr(body.doctorName ?? existing?.doctorName),
    doctorCode: trimStr(body.doctorCode ?? existing?.doctorCode),
    scCode: trimStr(body.scCode ?? existing?.scCode),
    mslNo: trimStr(body.mslNo ?? existing?.mslNo),
    speciality: trimStr(body.speciality ?? existing?.speciality),
    hospitalName,
    clinicName: '',
    campAddress: trimStr(body.campAddress ?? existing?.campAddress),
    city: trimStr(body.city ?? existing?.city),
    state: trimStr(body.state ?? existing?.state),
    pincode: trimStr(body.pincode ?? existing?.pincode),
    campDate: campDate || existing?.campDate || '',
    ...schedule,
    expectedPatients: Math.max(
      0,
      Number(body.expectedPatients ?? existing?.expectedPatients ?? 0) || 0
    ),
    actualPatients: Math.max(
      0,
      Number(body.actualPatients ?? existing?.actualPatients ?? 0) || 0
    ),
    fieldPersonName: trimStr(body.fieldPersonName ?? existing?.fieldPersonName),
    fieldPersonPhone: trimStr(body.fieldPersonPhone ?? existing?.fieldPersonPhone),
    source: CAMP_OPS_SOURCES.includes(trimStr(body.source))
      ? trimStr(body.source)
      : existing?.source || 'dashboard',
    remarks: trimStr(body.remarks ?? existing?.remarks),
  };
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

router.get(
  '/dashboard/stats',
  canRead,
  asyncHandler(async (req, res) => {
    const filter = buildCampFilter(req.query);
    const camps = await CampOpsCamp.find(filter);
    const byStatus = Object.fromEntries(CAMP_OPS_STATUSES.map((s) => [s, 0]));
    for (const camp of camps) {
      byStatus[camp.status] = (byStatus[camp.status] || 0) + 1;
    }
    const overdueNotExecuted = camps.filter((c) => c.status === 'approved' && isCampOverdue(c))
      .length;

    const clients = await CampOpsClient.find({ isDeleted: false }).sort('name');
    const campaigns = await CampOpsCampaign.find({ isDeleted: false }).sort('name');

    const brandBreakdown = clients
      .map((brand) => ({
        id: brand._id,
        label: brand.name,
        value: camps.filter((c) => String(c.clientId) === String(brand._id)).length,
      }))
      .filter((item) => item.value > 0);

    const campaignBreakdown = campaigns
      .map((item) => ({
        id: item._id,
        label: `${item.clientName || 'Brand'} — ${item.division || item.name}`,
        division: item.division || item.name,
        value: camps.filter(
          (c) =>
            String(c.campaignId) === String(item._id) || c.campaignName === item.name
        ).length,
      }))
      .filter((entry) => entry.value > 0);

    const monthlyMap = new Map();
    for (const camp of camps) {
      const d = parseLocalDateInput(camp.campDate) || String(camp.campDate || '').slice(0, 10);
      if (!d || d.length < 7) continue;
      const key = d.slice(0, 7);
      monthlyMap.set(key, (monthlyMap.get(key) || 0) + 1);
    }

    res.json({
      dateRange: {
        from: req.query.dateFrom || null,
        to: req.query.dateTo || null,
      },
      hierarchy: {
        brands: { total: clients.length, items: brandBreakdown },
        campaigns: { total: campaigns.length, items: campaignBreakdown },
      },
      camps: {
        total: camps.length,
        byStatus: {
          ...byStatus,
          overdue_not_executed: overdueNotExecuted,
        },
        alerts: {
          reaction_required: 0,
          off_hours_pending: camps.filter(
            (c) => c.status === 'pending_review' && c.submittedOffHours
          ).length,
          weekend_attention_pending: camps.filter(
            (c) => c.status === 'pending_review' && c.submittedWeekendAttention
          ).length,
        },
      },
      charts: {
        byClient: groupCount(camps, (c) => c.clientName).slice(0, 10),
        byState: groupCount(
          camps.filter((c) => trimStr(c.state)),
          (c) => c.state
        ).slice(0, 10),
        byCampaignType: groupCount(camps, (c) => c.campaignType),
        monthlyTrends: [...monthlyMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([label, value]) => ({ label, value })),
      },
      meta: {
        statuses: CAMP_OPS_STATUSES,
        campNames: CAMP_NAME_OPTIONS,
        durationOptions: CAMP_OPS_DURATION_OPTIONS,
      },
    });
  })
);

router.get(
  '/dashboard/clients',
  canRead,
  asyncHandler(async (_req, res) => {
    const clients = await CampOpsClient.find({ isDeleted: false }).sort('name');
    res.json({ data: clients });
  })
);

/* -------------------------------------------------------------------------- */
/* Camps                                                                      */
/* -------------------------------------------------------------------------- */

router.get(
  '/camps',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const overdueOnly = req.query.overdue === '1' || req.query.overdue === 'true';
    const filter = buildCampFilter(req.query);

    if (overdueOnly) {
      filter.status = 'approved';
      const approved = await CampOpsCamp.find(filter).sort('-campDate -createdAt');
      const overdue = approved.filter(isCampOverdue).map(withCampSchedule);
      const total = overdue.length;
      const data = overdue.slice(skip, skip + limit);
      return res.json(paginated(data, total, page, limit));
    }

    const [rows, total] = await Promise.all([
      CampOpsCamp.find(filter).sort('-campDate -createdAt').skip(skip).limit(limit),
      CampOpsCamp.countDocuments(filter),
    ]);
    res.json(paginated(rows.map(withCampSchedule), total, page, limit));
  })
);

router.get(
  '/camps/export',
  canRead,
  asyncHandler(async (req, res) => {
    const overdueOnly = req.query.overdue === '1' || req.query.overdue === 'true';
    const filter = buildCampFilter(req.query);

    let camps;
    if (overdueOnly) {
      filter.status = 'approved';
      const approved = await CampOpsCamp.find(filter).sort('-campDate -createdAt');
      camps = approved.filter(isCampOverdue).map(withCampSchedule);
    } else {
      const rows = await CampOpsCamp.find(filter).sort('-campDate -createdAt');
      camps = rows.map(withCampSchedule);
    }

    const formatCampExportValue = (key, value) => {
      if (key === 'campDate' && value) return formatDate(value);
      return value ?? '';
    };

    const headers = ['Camp ID', ...CAMP_IMPORT_FIELDS.map((f) => f.label), 'Status'];
    const rows = camps.map((camp) => [
      camp.campId || '',
      ...CAMP_IMPORT_FIELDS.map((f) => formatCampExportValue(f.key, camp[f.key])),
      camp.status || '',
    ]);

    sendExcel(res, 'Camps_Export.xlsx', headers, rows, { sheetName: 'Camps' });
  })
);

router.post(
  '/camps/bulk-action',
  canRequest,
  asyncHandler(async (req, res) => {
    const { ids, action } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) {
      throw new AppError('Select at least one camp', 400, 'VALIDATION_ERROR');
    }

    const configs = {
      approve: { nextStatus: 'approved', from: ['pending_review'], needApprove: true },
      reject: { nextStatus: 'rejected', from: ['pending_review'], needApprove: true },
      execute: { nextStatus: 'executed', from: ['approved'], needApprove: true },
      delete: { needApprove: true },
    };
    const config = configs[action];
    if (!config) throw new AppError('Invalid bulk action', 400, 'VALIDATION_ERROR');
    if (
      config.needApprove &&
      !req.permissions.has(PERMISSIONS.ALL) &&
      !req.permissions.has(PERMISSIONS.CAMPS_APPROVE)
    ) {
      throw new AppError('Insufficient permissions for this bulk action', 403, 'FORBIDDEN');
    }

    const results = { success: [], failed: [] };
    const a = actor(req);

    for (const id of ids) {
      try {
        const camp = await CampOpsCamp.findOne({ _id: String(id), isDeleted: false });
        if (!camp) throw new Error('Camp not found');

        if (action === 'delete') {
          if (camp.status === 'executed' && !req.permissions.has(PERMISSIONS.ALL)) {
            throw new Error('Executed camps cannot be deleted');
          }
          camp.isDeleted = true;
          camp.deletedAt = new Date().toISOString();
          camp.deletedBy = a.id;
          await camp.save();
          results.success.push({ id: camp._id, campId: camp.campId });
          continue;
        }

        if (config.from && !config.from.includes(camp.status)) {
          throw new Error(`Camp ${camp.campId} is ${camp.status} and cannot be ${action}d`);
        }
        if (!canTransition(camp.status, config.nextStatus)) {
          throw new Error(`Camp ${camp.campId} cannot move to ${config.nextStatus}`);
        }

        camp.status = config.nextStatus;
        if (config.nextStatus === 'approved') {
          camp.approvedById = a.id;
          camp.approvedByEmail = a.email;
        }
        if (config.nextStatus === 'executed') {
          camp.executedById = a.id;
          camp.executedByEmail = a.email;
          camp.executedAt = new Date().toISOString();
        }
        await camp.save();
        results.success.push({ id: camp._id, campId: camp.campId });
      } catch (err) {
        results.failed.push({ id, reason: err.message });
      }
    }

    res.json({
      message: `Bulk ${action} finished`,
      summary: {
        requested: ids.length,
        success: results.success.length,
        failed: results.failed.length,
      },
      results,
    });
  })
);

router.get(
  '/camps/:id',
  canRead,
  asyncHandler(async (req, res) => {
    const camp = await CampOpsCamp.findOne({ _id: req.params.id, isDeleted: false });
    if (!camp) throw new AppError('Camp not found', 404, 'NOT_FOUND');
    res.json({ data: withCampSchedule(camp) });
  })
);

router.post(
  '/camps',
  canRequest,
  asyncHandler(async (req, res) => {
    const client = await resolveClientFromBody(req.body, { allowCreate: false });
    if (!client && !trimStr(req.body.clientName)) {
      throw new AppError('Client is required', 400, 'VALIDATION_ERROR');
    }
    let resolved = client;
    if (!resolved) {
      resolved = await resolveClientFromBody(req.body, { allowCreate: true });
    }
    if (!resolved) throw new AppError('Client not found', 404, 'NOT_FOUND');

    const payload = campPayloadFromBody(req.body, null, resolved);
    const tracking = captureSubmissionTracking();
    const a = actor(req);
    const camp = await CampOpsCamp.create({
      ...payload,
      campId: await generateCampId(payload.campDate),
      status: 'pending_review',
      createdById: a.id,
      createdByEmail: a.email,
      ...tracking,
    });

    await audit(req, 'camp_ops.create', 'camp_ops_camp', camp._id, null, camp.toObject());
    res.status(201).json({ data: withCampSchedule(camp) });
  })
);

router.put(
  '/camps/:id',
  canRequest,
  asyncHandler(async (req, res) => {
    const camp = await CampOpsCamp.findOne({ _id: req.params.id, isDeleted: false });
    if (!camp) throw new AppError('Camp not found', 404, 'NOT_FOUND');
    if (!isCampEditable(camp.status)) {
      throw new AppError('Executed or cancelled camps cannot be edited', 400, 'VALIDATION_ERROR');
    }

    const before = camp.toObject();
    let client = null;
    if (req.body.clientId !== undefined || req.body.client !== undefined || req.body.clientName) {
      client = await resolveClientFromBody(req.body, { allowCreate: false });
      if (!client) throw new AppError('Client not found', 404, 'NOT_FOUND');
    }

    const payload = campPayloadFromBody(req.body, camp, client);
    Object.assign(camp, payload);
    await camp.save();
    await audit(req, 'camp_ops.update', 'camp_ops_camp', camp._id, before, camp.toObject());
    res.json({ data: withCampSchedule(camp) });
  })
);

async function transitionCamp(req, res, nextStatus, action) {
  const camp = await CampOpsCamp.findOne({ _id: req.params.id, isDeleted: false });
  if (!camp) throw new AppError('Camp not found', 404, 'NOT_FOUND');
  if (!canTransition(camp.status, nextStatus)) {
    throw new AppError(
      `Cannot transition from ${camp.status} to ${nextStatus}`,
      400,
      'VALIDATION_ERROR'
    );
  }

  const before = camp.toObject();
  const a = actor(req);
  camp.status = nextStatus;

  if (nextStatus === 'pending_review') {
    Object.assign(camp, captureSubmissionTracking());
  }
  if (nextStatus === 'approved') {
    camp.approvedById = a.id;
    camp.approvedByEmail = a.email;
  }
  if (nextStatus === 'executed') {
    camp.executedById = a.id;
    camp.executedByEmail = a.email;
    camp.executedAt = new Date().toISOString();
    if (req.body?.actualPatients != null) {
      camp.actualPatients = Math.max(0, Number(req.body.actualPatients) || 0);
    }
  }
  if (nextStatus === 'cancelled') {
    const cancelledBy = trimStr(req.body?.cancelledBy).toLowerCase();
    const remarks = trimStr(req.body?.remarks);
    if (!CAMP_OPS_CANCEL_SOURCES.includes(cancelledBy)) {
      throw new AppError('Select who cancelled the camp: brand or khw', 400, 'VALIDATION_ERROR');
    }
    if (!remarks) {
      throw new AppError('Cancellation remark is required', 400, 'VALIDATION_ERROR');
    }
    camp.cancelledBy = cancelledBy;
    camp.remarks = remarks;
  } else if (req.body?.remarks) {
    camp.remarks = trimStr(req.body.remarks);
  }

  await camp.save();
  await audit(req, `camp_ops.${action}`, 'camp_ops_camp', camp._id, before, camp.toObject());
  res.json({ data: withCampSchedule(camp) });
}

router.post(
  '/camps/:id/submit-review',
  canRequest,
  asyncHandler(async (req, res) => transitionCamp(req, res, 'pending_review', 'submit_review'))
);
router.post(
  '/camps/:id/approve',
  canApprove,
  asyncHandler(async (req, res) => transitionCamp(req, res, 'approved', 'approve'))
);
router.post(
  '/camps/:id/reject',
  canApprove,
  asyncHandler(async (req, res) => transitionCamp(req, res, 'rejected', 'reject'))
);
router.post(
  '/camps/:id/cancel',
  canApprove,
  asyncHandler(async (req, res) => transitionCamp(req, res, 'cancelled', 'cancel'))
);
router.post(
  '/camps/:id/execute',
  canApprove,
  asyncHandler(async (req, res) => transitionCamp(req, res, 'executed', 'execute'))
);

router.delete(
  '/camps/:id',
  canApprove,
  asyncHandler(async (req, res) => {
    const camp = await CampOpsCamp.findOne({ _id: req.params.id, isDeleted: false });
    if (!camp) throw new AppError('Camp not found', 404, 'NOT_FOUND');
    if (camp.status === 'executed' && !req.permissions.has(PERMISSIONS.ALL)) {
      throw new AppError('Executed camps cannot be deleted', 400, 'VALIDATION_ERROR');
    }
    const before = camp.toObject();
    camp.isDeleted = true;
    camp.deletedAt = new Date().toISOString();
    camp.deletedBy = actor(req).id;
    await camp.save();
    await audit(req, 'camp_ops.soft_delete', 'camp_ops_camp', camp._id, before, camp.toObject());
    res.json({ message: 'Camp archived successfully', data: { ok: true } });
  })
);

/* -------------------------------------------------------------------------- */
/* Clients                                                                    */
/* -------------------------------------------------------------------------- */

router.get(
  '/clients',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { isDeleted: false };
    const search = trimStr(req.query.search || req.query.q);
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: regex }, { code: regex }];
    }
    const [data, total] = await Promise.all([
      CampOpsClient.find(filter).sort('name').skip(skip).limit(limit),
      CampOpsClient.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/clients/:id',
  canRead,
  asyncHandler(async (req, res) => {
    const client = await CampOpsClient.findOne({ _id: req.params.id, isDeleted: false });
    if (!client) throw new AppError('Client not found', 404, 'NOT_FOUND');
    res.json({ data: client });
  })
);

router.post(
  '/clients',
  canRequest,
  asyncHandler(async (req, res) => {
    const name = trimStr(req.body.name);
    if (!name) throw new AppError('Client name is required', 400, 'VALIDATION_ERROR');
    const code =
      trimStr(req.body.code).toUpperCase() ||
      (await ensureUniqueClientCode(buildClientCode(name)));

    const existing = await CampOpsClient.findOne({
      isDeleted: false,
      $or: [{ name }, { code }],
    });
    if (existing) {
      throw new AppError('Client with this name or code already exists', 409, 'CONFLICT');
    }

    const client = await CampOpsClient.create({
      name,
      code,
      isActive: req.body.isActive !== false,
    });
    await audit(req, 'camp_ops.client_create', 'camp_ops_client', client._id, null, client.toObject());
    res.status(201).json({ data: client });
  })
);

router.put(
  '/clients/:id',
  canRequest,
  asyncHandler(async (req, res) => {
    const client = await CampOpsClient.findOne({ _id: req.params.id, isDeleted: false });
    if (!client) throw new AppError('Client not found', 404, 'NOT_FOUND');
    const before = client.toObject();
    const name = req.body.name !== undefined ? trimStr(req.body.name) : client.name;
    const code =
      req.body.code !== undefined ? trimStr(req.body.code).toUpperCase() : client.code;
    if (!name || !code) {
      throw new AppError('Client name and code are required', 400, 'VALIDATION_ERROR');
    }
    const duplicate = await CampOpsClient.findOne({
      isDeleted: false,
      $or: [{ name }, { code }],
    });
    if (duplicate && String(duplicate._id) !== String(client._id)) {
      throw new AppError('Another client already uses this name or code', 409, 'CONFLICT');
    }
    client.name = name;
    client.code = code;
    if (req.body.isActive !== undefined) client.isActive = req.body.isActive !== false;
    await client.save();
    await audit(req, 'camp_ops.client_update', 'camp_ops_client', client._id, before, client.toObject());
    res.json({ data: client });
  })
);

router.delete(
  '/clients/:id',
  canApprove,
  asyncHandler(async (req, res) => {
    const client = await CampOpsClient.findOne({ _id: req.params.id, isDeleted: false });
    if (!client) throw new AppError('Client not found', 404, 'NOT_FOUND');
    const before = client.toObject();
    client.isDeleted = true;
    client.isActive = false;
    client.deletedAt = new Date().toISOString();
    client.deletedBy = actor(req).id;
    await client.save();
    await audit(req, 'camp_ops.client_delete', 'camp_ops_client', client._id, before, client.toObject());
    res.json({ message: 'Client archived successfully', data: { ok: true } });
  })
);

/* -------------------------------------------------------------------------- */
/* Client masters                                                             */
/* -------------------------------------------------------------------------- */

const MASTER_STRING_FIELDS = [
  'programName',
  'campName',
  'campType',
  'coordinatorName',
  'healthcareWorker',
  'campDuration',
  'spocName',
  'spocNumber',
  'requestTimeline',
];
const MASTER_NUMERIC_FIELDS = [
  'poAmount',
  'executedCampUnit',
  'cancelledCampUnit',
  'otUnit',
  'minimumPatientCovered',
  'minimumKmsCovered',
  'extPatientUnit',
  'kmsUnit',
];

function buildMasterPayload(body, client) {
  const payload = {
    clientId: client._id,
    clientName: client.name,
    isActive: body.isActive !== false,
  };
  for (const field of MASTER_STRING_FIELDS) {
    if (body[field] !== undefined) {
      payload[field] =
        field === 'campName' ? normalizeCampName(body[field]) : trimStr(body[field]);
    }
  }
  for (const field of MASTER_NUMERIC_FIELDS) {
    if (body[field] !== undefined) {
      const n = Number(body[field]);
      payload[field] = Number.isNaN(n) ? 0 : n;
    }
  }
  return payload;
}

router.get(
  '/client-masters',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.clientId) filter.clientId = String(req.query.clientId);
    const search = trimStr(req.query.search || req.query.q);
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ clientName: regex }, { programName: regex }, { campName: regex }];
    }
    const [data, total] = await Promise.all([
      CampOpsClientMaster.find(filter).sort('-updatedAt').skip(skip).limit(limit),
      CampOpsClientMaster.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

const CLIENT_MASTER_HEADERS = [
  'Client Name',
  'Program Name',
  'Camp Name',
  'Camp Type',
  'Coordinator',
  'Healthcare Worker',
  'Camp Duration',
  'SPOC Name',
  'SPOC Number',
  'Request Timeline',
  'PO Amount',
  'Executed Camp Unit',
  'Cancelled Camp Unit',
  'OT Unit',
  'Min Patients',
  'Min KMs',
  'Ext Patient Unit',
  'KMs Unit',
  'Active',
];

router.get(
  '/client-masters/export',
  canRead,
  asyncHandler(async (_req, res) => {
    const rows = await CampOpsClientMaster.find({ isDeleted: false }).sort('-updatedAt');
    sendExcel(
      res,
      'Client_Master.xlsx',
      CLIENT_MASTER_HEADERS,
      rows.map((r) => [
        r.clientName,
        r.programName,
        r.campName,
        r.campType,
        r.coordinatorName,
        r.healthcareWorker,
        r.campDuration,
        r.spocName,
        r.spocNumber,
        r.requestTimeline,
        r.poAmount,
        r.executedCampUnit,
        r.cancelledCampUnit,
        r.otUnit,
        r.minimumPatientCovered,
        r.minimumKmsCovered,
        r.extPatientUnit,
        r.kmsUnit,
        r.isActive === false ? 'No' : 'Yes',
      ]),
      { sheetName: 'Client Master' }
    );
  })
);

router.get(
  '/client-masters/sample',
  canRead,
  asyncHandler(async (_req, res) => {
    sendExcel(
      res,
      'Client_Master_Sample.xlsx',
      CLIENT_MASTER_HEADERS,
      [
        [
          'Acme Health',
          'Orthopedics',
          'BMD',
          'Fixed',
          'Ravi Kumar',
          'Dr. Meera',
          '4',
          'Priya Shah',
          '9876543210',
          '7 days',
          150000,
          10,
          1,
          2,
          120,
          500,
          15,
          25,
          'Yes',
        ],
      ],
      { sheetName: 'Client Master' }
    );
  })
);

router.post(
  '/client-masters/import',
  canRequest,
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Excel file required', 400, 'VALIDATION_ERROR');
    const rows = parseSheetRows(req.file.buffer);
    const errors = [];
    let created = 0;
    const a = actor(req);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      try {
        const clientName = cellValue(row, ['Client Name', 'Client', 'clientName']);
        if (!clientName) continue;
        const client = await resolveClientFromBody({ clientName }, { allowCreate: true });
        if (!client) throw new AppError('Client is required', 400, 'VALIDATION_ERROR');
        const body = {
          clientName,
          programName: cellValue(row, ['Program Name', 'Division / Therapy', 'programName']),
          campName: cellValue(row, ['Camp Name', 'campName']) || 'BMD',
          campType: cellValue(row, ['Camp Type', 'Service Model', 'campType']),
          coordinatorName: cellValue(row, ['Coordinator', 'coordinatorName']),
          healthcareWorker: cellValue(row, ['Healthcare Worker', 'HCW', 'healthcareWorker']),
          campDuration: cellValue(row, ['Camp Duration', 'Duration', 'campDuration']),
          spocName: cellValue(row, ['SPOC Name', 'spocName']),
          spocNumber: cellValue(row, ['SPOC Number', 'spocNumber']),
          requestTimeline: cellValue(row, ['Request Timeline', 'requestTimeline']),
          poAmount: cellValue(row, ['PO Amount', 'poAmount']),
          executedCampUnit: cellValue(row, ['Executed Camp Unit', 'executedCampUnit']),
          cancelledCampUnit: cellValue(row, ['Cancelled Camp Unit', 'cancelledCampUnit']),
          otUnit: cellValue(row, ['OT Unit', 'otUnit']),
          minimumPatientCovered: cellValue(row, ['Min Patients', 'minimumPatientCovered']),
          minimumKmsCovered: cellValue(row, ['Min KMs', 'minimumKmsCovered']),
          extPatientUnit: cellValue(row, ['Ext Patient Unit', 'extPatientUnit']),
          kmsUnit: cellValue(row, ['KMs Unit', 'kmsUnit']),
          isActive: !['no', 'false', '0', 'inactive'].includes(
            cellValue(row, ['Active', 'isActive']).toLowerCase()
          ),
        };
        const payload = buildMasterPayload(body, client);
        await CampOpsClientMaster.create({
          ...payload,
          createdById: a.id,
          updatedById: a.id,
        });
        created += 1;
      } catch (err) {
        errors.push({ row: rowNum, field: 'import', message: err.message });
      }
    }

    res.json({
      data: {
        totalRows: rows.length,
        created,
        updated: 0,
        errorRows: errors.length,
        errors: errors.slice(0, 200),
      },
    });
  })
);

router.get(
  '/client-masters/by-client/:clientId',
  canRead,
  asyncHandler(async (req, res) => {
    const data = await CampOpsClientMaster.find({
      isDeleted: false,
      clientId: String(req.params.clientId),
    }).sort('programName');
    res.json({ data });
  })
);

router.get(
  '/client-masters/by-client/:clientId/divisions',
  canRead,
  asyncHandler(async (req, res) => {
    const clientId = String(req.params.clientId);
    const client = await CampOpsClient.findOne({ _id: clientId, isDeleted: false });
    if (!client) throw new AppError('Client not found', 404, 'NOT_FOUND');

    const records = await CampOpsClientMaster.find({
      isDeleted: false,
      clientId,
    }).sort('programName');

    const divisionMap = new Map();
    for (const record of records) {
      const division = trimStr(record.programName || record.campType);
      if (!division) continue;
      if (!divisionMap.has(division)) {
        divisionMap.set(division, {
          programName: division,
          campNames: [],
          isActive: false,
        });
      }
      const entry = divisionMap.get(division);
      const campName = trimStr(record.campName);
      if (campName && !entry.campNames.includes(campName)) {
        entry.campNames.push(campName);
      }
      if (record.isActive !== false) entry.isActive = true;
    }

    res.json({
      data: [...divisionMap.values()],
      divisions: [...divisionMap.keys()],
    });
  })
);

router.get(
  '/client-masters/:id',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    res.json({ data: row });
  })
);

router.post(
  '/client-masters',
  canRequest,
  asyncHandler(async (req, res) => {
    const client = await resolveClientFromBody(req.body, { allowCreate: true });
    if (!client) throw new AppError('Client is required', 400, 'VALIDATION_ERROR');
    const payload = buildMasterPayload(req.body, client);
    if (!payload.campName) payload.campName = 'BMD';
    const a = actor(req);
    const row = await CampOpsClientMaster.create({
      ...payload,
      createdById: a.id,
      updatedById: a.id,
    });
    await audit(req, 'camp_ops.client_master_create', 'camp_ops_client_master', row._id, null, row.toObject());
    res.status(201).json({ data: row });
  })
);

router.put(
  '/client-masters/:id',
  canRequest,
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    const before = row.toObject();
    let client = null;
    if (req.body.clientId || req.body.clientName) {
      client = await resolveClientFromBody(req.body, { allowCreate: false });
      if (!client) throw new AppError('Client not found', 404, 'NOT_FOUND');
    } else {
      client = await CampOpsClient.findOne({ _id: row.clientId, isDeleted: false });
      if (!client) {
        client = { _id: row.clientId, name: row.clientName };
      }
    }
    Object.assign(row, buildMasterPayload({ ...row.toObject(), ...req.body }, client));
    row.updatedById = actor(req).id;
    await row.save();
    await audit(req, 'camp_ops.client_master_update', 'camp_ops_client_master', row._id, before, row.toObject());
    res.json({ data: row });
  })
);

router.delete(
  '/client-masters/:id',
  canApprove,
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    row.isDeleted = true;
    row.deletedAt = new Date().toISOString();
    await row.save();
    await audit(req, 'camp_ops.client_master_delete', 'camp_ops_client_master', row._id, null, {
      ok: true,
    });
    res.json({ message: 'Client master archived successfully', data: { ok: true } });
  })
);

router.get(
  '/client-masters/:id/document',
  canRead,
  asyncHandler(async (_req, res) => {
    throw new AppError('No program document uploaded', 404, 'NOT_FOUND');
  })
);

router.post(
  '/client-masters/:id/document',
  canRequest,
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    row.programDocument = {
      fileName: req.body?.fileName || 'document.pdf',
      storedName: '',
      mimeType: 'application/pdf',
      fileSize: 0,
      uploadedAt: new Date().toISOString(),
    };
    await row.save();
    res.json({ data: row });
  })
);

router.delete(
  '/client-masters/:id/document',
  canRequest,
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    row.programDocument = null;
    await row.save();
    res.json({ data: row });
  })
);

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

router.get(
  '/import/fields',
  canRead,
  asyncHandler(async (_req, res) => {
    res.json({
      fields: CAMP_IMPORT_FIELDS,
      standardMapping: STANDARD_IMPORT_MAPPING,
      isSuperAdmin: false,
    });
  })
);

router.get(
  '/import/templates',
  canRead,
  asyncHandler(async (_req, res) => {
    const data = await CampOpsImportTemplate.find({ isDeleted: false }).sort('-updatedAt');
    res.json({ data });
  })
);

router.post(
  '/import/templates',
  canRequest,
  asyncHandler(async (req, res) => {
    const name = trimStr(req.body?.name);
    const mapping = req.body?.mapping && typeof req.body.mapping === 'object' ? req.body.mapping : {};
    if (!name) throw new AppError('Template name is required', 400, 'VALIDATION_ERROR');
    const a = actor(req);
    const row = await CampOpsImportTemplate.create({
      name,
      mapping,
      createdById: a.id,
      createdByEmail: a.email,
    });
    res.status(201).json({ data: row });
  })
);

router.delete(
  '/import/templates/:id',
  canRequest,
  asyncHandler(async (req, res) => {
    const row = await CampOpsImportTemplate.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Template not found', 404, 'NOT_FOUND');
    row.isDeleted = true;
    row.deletedAt = new Date().toISOString();
    await row.save();
    res.json({ data: { ok: true } });
  })
);

router.get(
  '/import/sample',
  canRead,
  asyncHandler(async (_req, res) => {
    const headers = CAMP_IMPORT_FIELDS.map((f) => f.label);
    const rows = [
      [
        'Acme Pharma',
        'Screening',
        'BMD',
        'Dr Example',
        'D001',
        '12 Main Street',
        'Mumbai',
        'Maharashtra',
        '400001',
        '01-08-26',
        '09:00',
        '12:00',
        '40',
        'Rep One',
        '9999999999',
        'Sample camp row',
      ],
      [
        'Acme Pharma',
        'Oncology',
        'Physio & Nuero',
        'Dr Sharma',
        'D002',
        '45 Park Avenue',
        'Pune',
        'Maharashtra',
        '411001',
        '15-08-26',
        '10:00',
        '14:00',
        '25',
        'Rep Two',
        '9888888888',
        '',
      ],
    ];
    sendExcel(res, 'camp-import-sample.xlsx', headers, rows, { sheetName: 'Camps' });
  })
);

router.post(
  '/import/parse',
  canRequest,
  asyncHandler(async (req, res) => {
    // Stub: accept pre-parsed rows/headers from client (no Excel binary parsing required).
    const headers = Array.isArray(req.body?.headers) ? req.body.headers : [];
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const suggestions = {};
    for (const field of CAMP_IMPORT_FIELDS) {
      const aliases = [field.label, field.key].map((v) => String(v).toLowerCase());
      const match = headers.find((h) => {
        const n = String(h || '').toLowerCase();
        return aliases.some((a) => n === a || n.includes(a));
      });
      if (match) suggestions[field.key] = match;
    }
    res.json({
      fileName: req.body?.fileName || 'upload',
      sheetName: req.body?.sheetName || 'Sheet1',
      headers,
      sampleRows: rows.slice(0, 5),
      totalRows: rows.length,
      suggestions,
      rows,
      standardMapping: STANDARD_IMPORT_MAPPING,
      missingStandardHeaders: [],
      isSuperAdmin: false,
      stub: true,
    });
  })
);

router.post(
  '/import/preview',
  canRequest,
  asyncHandler(async (req, res) => {
    const { rows, mapping, defaultClientName = '' } = req.body || {};
    if (!Array.isArray(rows) || !mapping) {
      throw new AppError('Rows and mapping are required', 400, 'VALIDATION_ERROR');
    }
    const mappedRows = mapImportRows(rows, mapping, defaultClientName);
    const { validRows, invalidRows } = validateMappedImportRows(mappedRows);
    res.json({
      summary: {
        total: mappedRows.length,
        valid: validRows.length,
        invalid: invalidRows.length,
      },
      validRows,
      invalidRows,
      mapping,
    });
  })
);

router.post(
  '/import/confirm',
  canRequest,
  asyncHandler(async (req, res) => {
    const { rows, mapping, defaultClientName = '' } = req.body || {};
    if (!Array.isArray(rows) || !mapping) {
      throw new AppError('Rows and mapping are required', 400, 'VALIDATION_ERROR');
    }
    const mappedRows = mapImportRows(rows, mapping, defaultClientName);
    const { validRows, invalidRows } = validateMappedImportRows(mappedRows);
    if (!validRows.length) {
      throw new AppError('No valid rows to import', 400, 'VALIDATION_ERROR', { invalidRows });
    }

    const clients = await CampOpsClient.find({ isDeleted: false });
    const clientMap = new Map(clients.map((c) => [c.name.toLowerCase(), c]));
    const a = actor(req);
    const created = [];
    const skipped = [];

    for (const row of validRows) {
      let client = clientMap.get(row.clientName.toLowerCase());
      if (!client) {
        client = await CampOpsClient.create({
          name: row.clientName,
          code: await ensureUniqueClientCode(buildClientCode(row.clientName)),
          isActive: true,
        });
        clientMap.set(row.clientName.toLowerCase(), client);
      }

      const schedule = resolveCampSchedule({
        startTime: row.startTime,
        endTime: row.endTime,
        durationHours: row.durationHours,
      });
      const tracking = captureSubmissionTracking();
      const camp = await CampOpsCamp.create({
        campId: await generateCampId(row.campDate),
        clientId: client._id,
        clientName: client.name,
        campaignName: normalizeCampName(row.campaignName),
        campaignType: row.campaignType || 'Screening',
        doctorName: row.doctorName,
        doctorCode: row.doctorCode,
        campAddress: row.campAddress,
        city: row.city,
        state: row.state,
        pincode: row.pincode,
        campDate: row.campDate,
        ...schedule,
        expectedPatients: row.expectedPatients || 0,
        fieldPersonName: row.fieldPersonName,
        fieldPersonPhone: row.fieldPersonPhone,
        remarks: row.remarks,
        source: 'excel',
        status: 'pending_review',
        createdById: a.id,
        createdByEmail: a.email,
        ...tracking,
      });
      created.push(withCampSchedule(camp));
    }

    await audit(req, 'camp_ops.import_confirm', 'camp_ops_import', null, null, {
      created: created.length,
      skipped: skipped.length,
      invalid: invalidRows.length,
    });

    res.status(201).json({
      message: 'Import completed',
      summary: {
        created: created.length,
        skipped: skipped.length,
        invalid: invalidRows.length,
      },
      created,
      skipped,
      invalidRows,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* Communications                                                             */
/* -------------------------------------------------------------------------- */

router.get(
  '/communications/email/status',
  canRead,
  asyncHandler(async (_req, res) => {
    res.json({
      data: {
        configured: false,
        connected: false,
        lastSyncAt: null,
        pendingMessages: 0,
        message: 'Email ingest is not configured on TYLO Camp Ops (stub).',
      },
    });
  })
);

router.get(
  '/communications/email/config',
  canRead,
  asyncHandler(async (_req, res) => {
    res.json({
      data: {
        enabled: false,
        host: '',
        port: 993,
        user: '',
        mailbox: 'INBOX',
        configured: false,
      },
    });
  })
);

router.put(
  '/communications/email/config',
  canApprove,
  asyncHandler(async (req, res) => {
    res.json({
      data: {
        ...(req.body || {}),
        configured: false,
        message: 'Email config saved locally in request only (stub).',
      },
    });
  })
);

router.post(
  '/communications/email/sync',
  canRequest,
  asyncHandler(async (_req, res) => {
    res.json({ data: { synced: 0, failed: 0, message: 'Email sync not configured (stub).' } });
  })
);

router.get(
  '/communications/email/messages',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit } = parsePagination(req.query);
    res.json(paginated([], 0, page, limit));
  })
);

router.get(
  '/communications/email/messages/:id',
  canRead,
  asyncHandler(async (_req, res) => {
    throw new AppError('Email message not found', 404, 'NOT_FOUND');
  })
);

router.post(
  '/communications/email/messages/:id/extract',
  canRequest,
  asyncHandler(async (_req, res) => {
    throw new AppError('Email extract not available (stub)', 501, 'NOT_IMPLEMENTED');
  })
);

router.put(
  '/communications/email/messages/:id/preview',
  canRequest,
  asyncHandler(async (req, res) => {
    res.json({ data: req.body?.previewData || null });
  })
);

router.post(
  '/communications/email/messages/:id/process',
  canRequest,
  asyncHandler(async (_req, res) => {
    throw new AppError('Email process not available (stub)', 501, 'NOT_IMPLEMENTED');
  })
);

router.post(
  '/communications/email/messages/:id/archive',
  canRequest,
  asyncHandler(async (_req, res) => {
    res.json({ data: { ok: true } });
  })
);

router.post(
  '/communications/email/messages/:id/restore',
  canRequest,
  asyncHandler(async (_req, res) => {
    res.json({ data: { ok: true } });
  })
);

router.post(
  '/communications/paste/extract',
  canRequest,
  asyncHandler(async (req, res) => {
    const text = trimStr(req.body?.text);
    if (!text) throw new AppError('Paste text is required', 400, 'VALIDATION_ERROR');
    const defaults = {
      clientName: trimStr(req.body?.clientName),
      campaignType: trimStr(req.body?.campaignType),
      campaignName: trimStr(req.body?.campaignName),
    };
    const data = await extractManualPastePreview({ text, defaults });
    res.json({ data });
  })
);

router.post(
  '/communications/paste/process',
  canRequest,
  asyncHandler(async (req, res) => {
    const defaults = {
      clientName: trimStr(req.body?.clientName),
      campaignType: trimStr(req.body?.campaignType),
      campaignName: trimStr(req.body?.campaignName),
    };
    const data = await processManualPaste(
      {
        previewData: req.body?.previewData,
        text: trimStr(req.body?.text),
        defaults,
      },
      actor(req),
      { resolveClientFromBody, campPayloadFromBody },
    );
    res.json({
      data,
      message: `Created ${data.created} camp(s) from pasted content`,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* Users (compat)                                                             */
/* -------------------------------------------------------------------------- */

router.get(
  '/users/roles',
  canRead,
  asyncHandler(async (_req, res) => {
    res.json({ data: CAMP_OPS_ROLE_CATALOG });
  })
);

router.get(
  '/users',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { isDeleted: false };
    const search = trimStr(req.query.search || req.query.q);
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      filter.$or = [
        { fullName: regex },
        { name: regex },
        { email: regex },
        { username: regex },
      ];
    }
    try {
      const [users, total] = await Promise.all([
        User.find(filter)
          .populate('roleIds', 'name permissions')
          .sort('-createdAt')
          .skip(skip)
          .limit(limit)
          .select('-passwordHash'),
        User.countDocuments(filter),
      ]);
      const data = users.map((u) => {
        const obj = u.toObject ? u.toObject() : { ...u };
        delete obj.passwordHash;
        const roles = (obj.roleIds || [])
          .map((r) => (typeof r === 'object' ? r.name : ''))
          .filter(Boolean);
        const roleLabel = roles.join(', ') || '—';
        return {
          _id: obj._id,
          id: obj._id,
          name: obj.fullName || obj.name || '',
          fullName: obj.fullName || obj.name || '',
          email: obj.email || '',
          username: obj.username || '',
          isActive: obj.isActive !== false,
          phone: obj.phone || '',
          role: roleLabel,
          roles: roles.map((name) => ({ name })),
        };
      });
      res.json(paginated(data, total, page, limit));
    } catch {
      res.json(paginated([], 0, page, limit));
    }
  })
);

export default router;
