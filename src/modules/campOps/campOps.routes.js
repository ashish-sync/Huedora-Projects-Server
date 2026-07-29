import { Router } from 'express';
import { authenticate, requirePermission, requireAdmin } from '../../middleware/auth.js';
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
  CLIENT_MASTER_HEADERS,
  CLIENT_MASTER_SAMPLE_ROW,
  clientMasterToExcelRow,
  normalizeClientMasterDuration,
  parseClientMasterImportRow,
} from './clientMaster.excel.js';
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
import {
  extractPasteImportPreview,
  extractPasteImportPreviewFromRows,
  parsePasteImportFile,
} from './pasteImport.service.js';
import { matchImportColumns, CAMP_PASTE_TABULAR_FIELD_KEYS } from './import/importColumnMatcher.js';
import {
  parseCampRequestWithValidation,
  parsedFieldsToCampRow,
  listClientParserConfigs,
} from './campRequestParser.service.js';
import {
  lifecyclePayloadFromBody,
  withCampLifecycle,
  canEditLifecycleStage,
  applyAssignmentStageOutcome,
  assertExecutionStageSave,
  EXECUTION_DOC_TYPES,
  resolveInTimeSelfieUrl,
  normalizePaymentSubmitStatus,
  PAYMENT_SUBMIT_STATUSES,
} from './campOps.lifecycle.js';
import {
  assertCampSubmittedToFinance,
  buildCampFinanceExportRow,
  campFinanceExportFilename,
  campFinanceExportHeaders,
} from './campFinanceExport.js';
import { getRequestStageBlockers, assertRequestStageComplete } from './campOps.requestValidation.js';
import {
  resolveCampClientScope,
  applyClientScopeToFilter,
  assertCampClientAccess,
  parseAssignedUserEmails,
} from './campOps.clientAccess.js';
import {
  withRequestReview,
  applyRequestReviewTransition,
  persistRequestReviewOverdue,
} from './campOps.requestReview.js';
import {
  applyCampClosure,
  CAMP_CLOSURE_TYPES,
  CAMP_CLOSURE_REASON_CODES,
  canCloseCampStatus,
  canCloseCampRecord,
} from './campOps.closure.js';
import { notifyCampWorkflow } from './campOps.notifications.js';
import {
  handleEmailArchive,
  handleEmailConfigGet,
  handleEmailConfigPut,
  handleEmailExtract,
  handleEmailMessageGet,
  handleEmailMessagesList,
  handleEmailPreviewSave,
  handleEmailProcess,
  handleEmailRestore,
  handleEmailStatus,
  handleEmailSync,
} from './communications.handlers.js';
import multer from 'multer';
import { uploadDir } from '../../config/paths.js';

const campUploadRoot = uploadDir('camp-ops');

const campDocUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, campUploadRoot),
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || 'document').replace(/[^\w.\-]+/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function enrichCamp(camp) {
  const obj = withRequestReview(withCampLifecycle(withCampSchedule(camp)));
  obj.inTimeSelfieUrl = resolveInTimeSelfieUrl(obj);
  const approvalBlockers = getRequestStageBlockers(obj);
  if (obj.requestIncomplete) {
    approvalBlockers.unshift('Request data is incomplete — complete all required fields before approval');
  }
  obj.approvalBlockers = approvalBlockers;
  obj.requestStageComplete = approvalBlockers.length === 0;
  const pendingReview = obj.status === 'pending_review';
  obj.canApprove = pendingReview && approvalBlockers.length === 0;
  obj.canRequestInformation = pendingReview;
  return obj;
}

async function scopeCampFilter(req, filter) {
  const scoped = await resolveCampClientScope(req.user);
  if (!scoped) return filter;
  return applyClientScopeToFilter(filter, scoped);
}


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
  const campAddress = trimStr(body.campAddress ?? existing?.campAddress) || hospitalName;

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
    hospitalName: campAddress ? '' : hospitalName,
    clinicName: '',
    campAddress,
    city: trimStr(body.city ?? existing?.city),
    state: trimStr(body.state ?? existing?.state),
    district: trimStr(body.district ?? existing?.district),
    pincode: trimStr(body.pincode ?? existing?.pincode),
    latitude:
      body.latitude !== undefined && body.latitude !== ''
        ? Number(body.latitude)
        : existing?.latitude ?? null,
    longitude:
      body.longitude !== undefined && body.longitude !== ''
        ? Number(body.longitude)
        : existing?.longitude ?? null,
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
    ...lifecyclePayloadFromBody(body, existing),
  };
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

router.get(
  '/dashboard/stats',
  canRead,
  asyncHandler(async (req, res) => {
    const filter = await scopeCampFilter(req, buildCampFilter(req.query));
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
    const requestReviewStatus = trimStr(req.query.requestReviewStatus);
    const filter = await scopeCampFilter(req, buildCampFilter(req.query));

    if (requestReviewStatus) {
      const rows = await CampOpsCamp.find(filter).sort('-campDate -createdAt');
      const filtered = rows.filter(
        (row) => enrichCamp(row).requestReviewStatus === requestReviewStatus,
      );
      const total = filtered.length;
      const data = filtered.slice(skip, skip + limit).map(enrichCamp);
      return res.json(paginated(data, total, page, limit));
    }

    if (overdueOnly) {
      filter.status = 'approved';
      const approved = await CampOpsCamp.find(filter).sort('-campDate -createdAt');
      const overdue = approved.filter(isCampOverdue).map(enrichCamp);
      const total = overdue.length;
      const data = overdue.slice(skip, skip + limit);
      return res.json(paginated(data, total, page, limit));
    }

    const [rows, total] = await Promise.all([
      CampOpsCamp.find(filter).sort('-campDate -createdAt').skip(skip).limit(limit),
      CampOpsCamp.countDocuments(filter),
    ]);
    res.json(paginated(rows.map(enrichCamp), total, page, limit));
  })
);

router.get(
  '/camps/export',
  canRead,
  asyncHandler(async (req, res) => {
    const overdueOnly = req.query.overdue === '1' || req.query.overdue === 'true';
    const filter = await scopeCampFilter(req, buildCampFilter(req.query));

    let camps;
    if (overdueOnly) {
      filter.status = 'approved';
      const approved = await CampOpsCamp.find(filter).sort('-campDate -createdAt');
      camps = approved.filter(isCampOverdue).map(enrichCamp);
    } else {
      const rows = await CampOpsCamp.find(filter).sort('-campDate -createdAt');
      camps = rows.map(enrichCamp);
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

        const before = camp.toObject();
        if (config.from && !config.from.includes(camp.status)) {
          throw new Error(`Camp ${camp.campId} is ${camp.status} and cannot be ${action}d`);
        }
        if (!canTransition(camp.status, config.nextStatus)) {
          throw new Error(`Camp ${camp.campId} cannot move to ${config.nextStatus}`);
        }

        camp.status = config.nextStatus;
        if (config.nextStatus === 'approved') {
          const blockers = getRequestStageBlockers(camp);
          if (blockers.length) throw new Error(blockers[0]);
          camp.approvedById = a.id;
          camp.approvedByEmail = a.email;
          applyRequestReviewTransition(camp, 'approve');
        }
        if (config.nextStatus === 'rejected') {
          const rejectionReason = trimStr(req.body?.rejectionReason || req.body?.remarks);
          if (!rejectionReason) throw new Error('Rejection reason is required');
          applyRequestReviewTransition(camp, 'reject', { reason: rejectionReason });
        }
        if (config.nextStatus === 'executed') {
          camp.executedById = a.id;
          camp.executedByEmail = a.email;
          camp.executedAt = new Date().toISOString();
        }
        await camp.save();
        await audit(req, `camp_ops.bulk_${action}`, 'camp_ops_camp', camp._id, before, camp.toObject());
        if (action === 'approve') {
          await notifyCampWorkflow({ camp, action: 'approve', actorId: a.id });
        } else if (action === 'reject') {
          await notifyCampWorkflow({
            camp,
            action: 'reject',
            actorId: a.id,
            note: trimStr(req.body?.rejectionReason || req.body?.remarks),
          });
        }
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
    await assertCampClientAccess(req.user, camp);
    const overdue = await persistRequestReviewOverdue(camp);
    if (overdue.becameOverdue) {
      await notifyCampWorkflow({ camp, action: 'review_overdue', actorId: null });
    }
    res.json({ data: enrichCamp(camp) });
  })
);

router.post(
  '/camps/:id/execution-documents',
  canRequest,
  campDocUpload.array('documents', 10),
  asyncHandler(async (req, res) => {
    const camp = await CampOpsCamp.findOne({ _id: req.params.id, isDeleted: false });
    if (!camp) throw new AppError('Camp not found', 404, 'NOT_FOUND');
    if (!canEditLifecycleStage(camp, 'execution')) {
      throw new AppError('Cannot upload execution documents for this camp', 400, 'VALIDATION_ERROR');
    }

    const docType = trimStr(req.body?.docType) || 'other';
    if (!EXECUTION_DOC_TYPES.includes(docType)) {
      throw new AppError('Invalid execution document type', 400, 'VALIDATION_ERROR');
    }
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) throw new AppError('Select at least one file', 400, 'VALIDATION_ERROR');
    if (docType === 'gps_selfie') {
      const invalid = files.find((file) => !String(file.mimetype || '').startsWith('image/'));
      if (invalid) {
        throw new AppError('GPS Selfie must be an image file', 400, 'VALIDATION_ERROR');
      }
    }

    const before = camp.toObject();
    const existing = Array.isArray(camp.executionDocuments) ? camp.executionDocuments : [];
    const uploadedAt = new Date().toISOString();
    const added = files.map((file) => ({
      id: file.filename,
      fileName: file.originalname,
      storedName: file.filename,
      docType,
      mimeType: file.mimetype,
      fileSize: file.size,
      url: `/uploads/camp-ops/${file.filename}`,
      uploadedAt,
    }));

    camp.executionDocuments = [...existing, ...added];

    if (docType === 'gps_selfie') {
      const selfie = added[added.length - 1];
      if (selfie?.url) {
        camp.inTimeSelfieUrl = selfie.url;
        camp.lifecycleStage = camp.lifecycleStage || 'execution';
      }
    }

    await camp.save();
    await audit(req, 'camp_ops.execution_docs', 'camp_ops_camp', camp._id, before, camp.toObject());
    res.json({ data: enrichCamp(camp) });
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
    try {
      assertRequestStageComplete({ ...payload, clientId: resolved._id, clientName: resolved.name });
    } catch (err) {
      throw new AppError(err.message || 'Complete all request stage fields', 400, 'VALIDATION_ERROR');
    }

    const tracking = captureSubmissionTracking();
    const a = actor(req);
    const camp = await CampOpsCamp.create({
      ...payload,
      campId: await generateCampId(payload.campDate),
      status: 'pending_review',
      lifecycleStage: 'request',
      requestDate: payload.requestDate || new Date().toISOString().slice(0, 10),
      createdById: a.id,
      createdByEmail: a.email,
      requestReviewStatus: 'review_pending',
      ...tracking,
    });

    await audit(req, 'camp_ops.create', 'camp_ops_camp', camp._id, null, camp.toObject());
    await notifyCampWorkflow({ camp, action: 'create', actorId: a.id });
    res.status(201).json({ data: enrichCamp(camp) });
  })
);

router.put(
  '/camps/:id',
  canRequest,
  asyncHandler(async (req, res) => {
    const camp = await CampOpsCamp.findOne({ _id: req.params.id, isDeleted: false });
    if (!camp) throw new AppError('Camp not found', 404, 'NOT_FOUND');
    await assertCampClientAccess(req.user, camp);

    const stage = trimStr(req.body.editingStage)
      || trimStr(req.body.lifecycleStage)
      || camp.lifecycleStage
      || 'request';
    const lifecycleOnly = req.body.lifecycleOnly === true;

    if (!canEditLifecycleStage(camp, stage)) {
      throw new AppError(`Cannot edit ${stage} stage for this camp`, 400, 'VALIDATION_ERROR');
    }

    const before = camp.toObject();
    let client = null;
    if (!lifecycleOnly && (req.body.clientId !== undefined || req.body.client !== undefined || req.body.clientName)) {
      client = await resolveClientFromBody(req.body, { allowCreate: false });
      if (!client) throw new AppError('Client not found', 404, 'NOT_FOUND');
    }

    const payload = campPayloadFromBody(req.body, camp, client);
    Object.assign(camp, payload);

    if (!lifecycleOnly || stage === 'request') {
      try {
        assertRequestStageComplete(camp);
        camp.requestIncomplete = false;
      } catch (err) {
        if (camp.requestIncomplete) {
          camp.requestIncomplete = true;
        } else {
          throw new AppError(err.message || 'Complete all request stage fields', 400, 'VALIDATION_ERROR');
        }
      }
      if (camp.requestReviewStatus === 'information_requested' && camp.status === 'pending_review') {
        applyRequestReviewTransition(camp, 'submit');
        Object.assign(camp, captureSubmissionTracking());
      }
    }

    if (stage === 'assignment' && camp.status === 'approved') {
      try {
        applyAssignmentStageOutcome(camp, req.body);
      } catch (err) {
        throw new AppError(err.message || 'Invalid assignment', 400, 'VALIDATION_ERROR');
      }
    }

    if (stage === 'execution') {
      try {
        assertExecutionStageSave(camp);
      } catch (err) {
        throw new AppError(err.message || 'Invalid execution stage', 400, 'VALIDATION_ERROR');
      }
    }

    if (camp.status === 'approved' && camp.lifecycleStage === 'request') {
      camp.lifecycleStage = 'assignment';
    }
    if (camp.status === 'executed' && ['request', 'assignment'].includes(camp.lifecycleStage)) {
      camp.lifecycleStage = 'execution';
    }

    await camp.save();
    await audit(req, 'camp_ops.update', 'camp_ops_camp', camp._id, before, camp.toObject());
    res.json({ data: enrichCamp(camp) });
  })
);

router.post(
  '/camps/:id/submit-to-finance',
  canRequest,
  asyncHandler(async (req, res) => {
    const camp = await CampOpsCamp.findOne({ _id: req.params.id, isDeleted: false });
    if (!camp) throw new AppError('Camp not found', 404, 'NOT_FOUND');
    if (!canEditLifecycleStage(camp, 'financial')) {
      throw new AppError('Financial stage is not editable for this camp', 400, 'VALIDATION_ERROR');
    }
    if (camp.submittedToFinanceAt) {
      throw new AppError('This camp payout was already submitted to Finance One', 400, 'ALREADY_SUBMITTED');
    }

    const before = camp.toObject();
    const payload = lifecyclePayloadFromBody(req.body, camp);
    Object.assign(camp, payload);

    const paymentSubmitStatus = normalizePaymentSubmitStatus(
      req.body.paymentSubmitStatus || camp.paymentSubmitStatus
    );
    if (!paymentSubmitStatus) {
      throw new AppError(
        'Select Payment Confirmed, Payment Not Checked, or Payment Hold before submitting',
        400,
        'VALIDATION_ERROR'
      );
    }
    if (!PAYMENT_SUBMIT_STATUSES.includes(paymentSubmitStatus)) {
      throw new AppError('Invalid payment submit status', 400, 'VALIDATION_ERROR');
    }

    const a = actor(req);
    const now = new Date().toISOString();
    camp.paymentSubmitStatus = paymentSubmitStatus;
    camp.financePaymentStatus = 'under_review';
    camp.submittedToFinanceAt = now;
    camp.submittedToFinanceById = a.id;
    camp.submittedToFinanceByEmail = a.email;
    camp.lifecycleStage = camp.lifecycleStage || 'financial';

    await camp.save();
    await audit(req, 'camp_ops.submit_to_finance', 'camp_ops_camp', camp._id, before, camp.toObject());
    res.json({ data: enrichCamp(camp) });
  })
);

router.get(
  '/camps/:id/finance-export',
  canRead,
  asyncHandler(async (req, res) => {
    const camp = await CampOpsCamp.findOne({ _id: req.params.id, isDeleted: false });
    if (!camp) throw new AppError('Camp not found', 404, 'NOT_FOUND');
    assertCampSubmittedToFinance(camp);
    sendExcel(
      res,
      campFinanceExportFilename(camp),
      campFinanceExportHeaders(),
      [buildCampFinanceExportRow(camp)],
      { sheetName: 'Camp Payout' },
    );
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
    applyRequestReviewTransition(camp, 'submit');
    Object.assign(camp, captureSubmissionTracking());
  }
  if (nextStatus === 'approved') {
    const blockers = getRequestStageBlockers(camp);
    if (blockers.length) {
      throw new AppError(blockers[0], 400, 'VALIDATION_ERROR');
    }
    camp.approvedById = a.id;
    camp.approvedByEmail = a.email;
    applyRequestReviewTransition(camp, 'approve');
    if (!camp.lifecycleStage || camp.lifecycleStage === 'request') {
      camp.lifecycleStage = 'assignment';
    }
  }
  if (nextStatus === 'rejected') {
    const rejectionReason = trimStr(req.body?.rejectionReason || req.body?.remarks);
    if (!rejectionReason) {
      throw new AppError('Rejection reason is required', 400, 'VALIDATION_ERROR');
    }
    applyRequestReviewTransition(camp, 'reject', { reason: rejectionReason });
  }
  if (nextStatus === 'executed') {
    camp.executedById = a.id;
    camp.executedByEmail = a.email;
    camp.executedAt = new Date().toISOString();
    camp.lifecycleStage = 'execution';
    camp.executionStatus = camp.executionStatus === 'Pending' ? 'Completed' : camp.executionStatus;
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
  if (nextStatus === 'pending_review') {
    await notifyCampWorkflow({ camp, action: 'submit_review', actorId: a.id });
  } else if (nextStatus === 'approved') {
    await notifyCampWorkflow({ camp, action: 'approve', actorId: a.id });
  } else if (nextStatus === 'rejected') {
    await notifyCampWorkflow({
      camp,
      action: 'reject',
      actorId: a.id,
      note: trimStr(req.body?.rejectionReason || req.body?.remarks),
    });
  }
  res.json({ data: enrichCamp(camp) });
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
  '/camps/:id/request-information',
  canApprove,
  asyncHandler(async (req, res) => {
    const camp = await CampOpsCamp.findOne({ _id: req.params.id, isDeleted: false });
    if (!camp) throw new AppError('Camp not found', 404, 'NOT_FOUND');
    if (camp.status !== 'pending_review') {
      throw new AppError('Only pending review camps can receive an information request', 400, 'VALIDATION_ERROR');
    }
    const note = trimStr(req.body?.informationRequestNote || req.body?.note || req.body?.remarks);
    if (!note) {
      throw new AppError('Information request note is required', 400, 'VALIDATION_ERROR');
    }
    const before = camp.toObject();
    applyRequestReviewTransition(camp, 'request_information', { actor: actor(req), reason: note });
    await camp.save();
    await audit(req, 'camp_ops.request_information', 'camp_ops_camp', camp._id, before, camp.toObject());
    await notifyCampWorkflow({
      camp,
      action: 'request_information',
      actorId: actor(req).id,
      note,
    });
    res.json({ data: enrichCamp(camp) });
  })
);
router.post(
  '/camps/:id/cancel',
  canApprove,
  asyncHandler(async (req, res) => transitionCamp(req, res, 'cancelled', 'cancel'))
);
router.post(
  '/camps/:id/close',
  canApprove,
  asyncHandler(async (req, res) => {
    const camp = await CampOpsCamp.findOne({ _id: req.params.id, isDeleted: false });
    if (!camp) throw new AppError('Camp not found', 404, 'NOT_FOUND');
    if (!canCloseCampRecord(camp)) {
      throw new AppError(
        camp.lifecycleStage === 'financial'
          ? 'Camps in Finance & Settlement cannot be cancelled or refused'
          : 'Camp is already closed',
        400,
        'VALIDATION_ERROR',
      );
    }

    const closureType = trimStr(req.body?.closureType || req.body?.assignmentRefusalReason);
    const reasonCode = trimStr(req.body?.reasonCode || req.body?.closureReasonCode);
    if (!CAMP_CLOSURE_TYPES.includes(closureType)) {
      throw new AppError('Select a closure type', 400, 'VALIDATION_ERROR');
    }
    if (!CAMP_CLOSURE_REASON_CODES.includes(reasonCode)) {
      throw new AppError('Select a reason code', 400, 'VALIDATION_ERROR');
    }

    const before = camp.toObject();
    applyCampClosure(camp, { closureType, reasonCode, actor: actor(req) });
    await camp.save();
    await audit(req, 'camp_ops.close', 'camp_ops_camp', camp._id, before, camp.toObject());
    res.json({ data: enrichCamp(camp) });
  })
);
router.post(
  '/camps/:id/execute',
  canApprove,
  asyncHandler(async (req, res) => transitionCamp(req, res, 'executed', 'execute'))
);

router.delete(
  '/camps/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    throw new AppError('Camps cannot be deleted. Cancel or refuse the camp instead.', 403, 'FORBIDDEN');
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
  requireAdmin,
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
  if (body.assignedUserEmails !== undefined) {
    payload.assignedUserEmails = parseAssignedUserEmails(body.assignedUserEmails);
  }
  for (const field of MASTER_STRING_FIELDS) {
    if (body[field] !== undefined) {
      if (field === 'campName') {
        payload[field] = normalizeCampName(body[field]);
      } else if (field === 'campDuration') {
        payload[field] = normalizeClientMasterDuration(body[field]);
      } else {
        payload[field] = trimStr(body[field]);
      }
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

function assertClientMasterPayload(payload) {
  if (!trimStr(payload.programName)) {
    throw new AppError('Division / Therapy is required', 400, 'VALIDATION_ERROR');
  }
  if (!trimStr(payload.campType)) {
    throw new AppError('Service Model is required', 400, 'VALIDATION_ERROR');
  }
  const method = trimStr(payload.campName);
  if (!method || method.toLowerCase() === 'others') {
    throw new AppError('Method is required', 400, 'VALIDATION_ERROR');
  }
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

router.get(
  '/client-masters/export',
  canRead,
  asyncHandler(async (_req, res) => {
    const rows = await CampOpsClientMaster.find({ isDeleted: false }).sort('-updatedAt');
    sendExcel(
      res,
      'Client_Master.xlsx',
      CLIENT_MASTER_HEADERS,
      rows.map((r) => clientMasterToExcelRow(r)),
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
      [CLIENT_MASTER_SAMPLE_ROW],
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
        const parsed = parseClientMasterImportRow(row);
        if (!parsed) continue;
        const client = await resolveClientFromBody({ clientName: parsed.clientName }, { allowCreate: true });
        if (!client) throw new AppError('Client is required', 400, 'VALIDATION_ERROR');
        const payload = buildMasterPayload(parsed, client);
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
    assertClientMasterPayload(payload);
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
    assertClientMasterPayload(row);
    row.updatedById = actor(req).id;
    await row.save();
    await audit(req, 'camp_ops.client_master_update', 'camp_ops_client_master', row._id, before, row.toObject());
    res.json({ data: row });
  })
);

router.delete(
  '/client-masters/:id',
  requireAdmin,
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
  requireAdmin,
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
  requireAdmin,
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
        'Neuro & Physio',
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
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (req.file?.buffer) {
      const parsed = await parsePasteImportFile(req.file.buffer);
      res.json({
        fileName: req.file.originalname || 'upload',
        sheetName: parsed.sheetName,
        headers: parsed.headers,
        sampleRows: parsed.sampleRows,
        totalRows: parsed.totalRows,
        suggestions: parsed.suggestions,
        rows: parsed.rows,
        mapping: parsed.mapping,
        columnResults: parsed.columnResults,
        unmappedHeaders: parsed.unmappedHeaders,
        unmappedFields: parsed.unmappedFields,
        fields: parsed.fields,
        standardMapping: parsed.standardMapping,
        missingStandardHeaders: parsed.missingRequiredFields,
        isSuperAdmin: false,
      });
      return;
    }

    const headers = Array.isArray(req.body?.headers) ? req.body.headers : [];
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const columnMatch = headers.length ? matchImportColumns(headers) : {
      mapping: {},
      suggestions: {},
      columnResults: [],
      unmappedHeaders: [],
      unmappedFields: [],
      missingRequiredFields: [],
    };

    res.json({
      fileName: req.body?.fileName || 'upload',
      sheetName: req.body?.sheetName || 'Sheet1',
      headers,
      sampleRows: rows.slice(0, 5),
      totalRows: rows.length,
      suggestions: columnMatch.suggestions,
      rows,
      mapping: columnMatch.mapping,
      columnResults: columnMatch.columnResults || [],
      unmappedHeaders: columnMatch.unmappedHeaders || [],
      unmappedFields: columnMatch.unmappedFields || [],
      standardMapping: STANDARD_IMPORT_MAPPING,
      missingStandardHeaders: columnMatch.missingRequiredFields || [],
      isSuperAdmin: false,
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
      created.push(enrichCamp(camp));
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

router.get('/communications/email/status', canRead, asyncHandler(handleEmailStatus));

router.get('/communications/email/config', canRead, asyncHandler(handleEmailConfigGet));

router.put('/communications/email/config', canApprove, asyncHandler(handleEmailConfigPut));

router.post('/communications/email/sync', canRequest, asyncHandler(handleEmailSync));

router.get('/communications/email/messages', canRead, asyncHandler(handleEmailMessagesList));

router.get('/communications/email/messages/:id', canRead, asyncHandler(handleEmailMessageGet));

router.post('/communications/email/messages/:id/extract', canRequest, asyncHandler(handleEmailExtract));

router.put('/communications/email/messages/:id/preview', canRequest, asyncHandler(handleEmailPreviewSave));

router.post('/communications/email/messages/:id/process', canRequest, asyncHandler(handleEmailProcess));

router.post('/communications/email/messages/:id/archive', canRequest, asyncHandler(handleEmailArchive));

router.post('/communications/email/messages/:id/restore', canRequest, asyncHandler(handleEmailRestore));

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
  '/communications/paste/parse-file',
  canRequest,
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file?.buffer) {
      throw new AppError('Excel or CSV file is required', 400, 'VALIDATION_ERROR');
    }
    const parsed = await parsePasteImportFile(req.file.buffer, {
      fieldKeys: CAMP_PASTE_TABULAR_FIELD_KEYS,
    });
    res.json({
      data: {
        ...parsed,
        fileName: req.file.originalname || 'upload',
      },
    });
  })
);

router.post(
  '/communications/paste/extract-file',
  canRequest,
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file?.buffer) {
      throw new AppError('Excel or CSV file is required', 400, 'VALIDATION_ERROR');
    }
    const defaults = {
      clientName: trimStr(req.body?.clientName),
      campaignType: trimStr(req.body?.campaignType),
      campaignName: trimStr(req.body?.campaignName),
    };
    let mapping = {};
    if (req.body?.mapping) {
      try {
        mapping = typeof req.body.mapping === 'string'
          ? JSON.parse(req.body.mapping)
          : req.body.mapping;
      } catch {
        throw new AppError('Invalid mapping JSON', 400, 'VALIDATION_ERROR');
      }
    }
    const data = await extractPasteImportPreview({
      buffer: req.file.buffer,
      fileName: req.file.originalname || 'upload',
      defaults,
      mapping,
    });
    res.json({ data });
  })
);

router.post(
  '/communications/paste/extract-rows',
  canRequest,
  asyncHandler(async (req, res) => {
    const data = await extractPasteImportPreviewFromRows({
      rows: req.body?.rows,
      headers: req.body?.headers,
      fileName: trimStr(req.body?.fileName) || 'upload',
      sheetName: trimStr(req.body?.sheetName) || 'Sheet1',
      mapping: req.body?.mapping || {},
      defaults: {
        clientName: trimStr(req.body?.clientName),
        campaignType: trimStr(req.body?.campaignType),
        campaignName: trimStr(req.body?.campaignName),
      },
    });
    res.json({ data });
  })
);

router.get(
  '/communications/parser/configs',
  canRead,
  asyncHandler(async (_req, res) => {
    const configs = listClientParserConfigs().map((cfg) => ({
      clientId: cfg.clientId,
      clientName: cfg.clientName,
      parserMode: cfg.parserMode,
    }));
    res.json({ data: configs });
  }),
);

router.post(
  '/communications/parser/parse',
  canRequest,
  asyncHandler(async (req, res) => {
    const data = await parseCampRequestWithValidation(
      {
        text: trimStr(req.body?.text),
        clientId: trimStr(req.body?.clientId),
        clientName: trimStr(req.body?.clientName),
        storeAudit: req.body?.storeAudit !== false,
      },
      actor(req),
    );
    res.json({ data });
  }),
);

router.post(
  '/communications/parser/process',
  canRequest,
  asyncHandler(async (req, res) => {
    const parsedFields = req.body?.parsedFields || req.body?.parsed_fields;
    if (!parsedFields) {
      throw new AppError('parsedFields is required', 400, 'VALIDATION_ERROR');
    }
    const defaults = {
      clientName: trimStr(req.body?.clientName),
      campaignType: trimStr(req.body?.campaignType),
      campaignName: trimStr(req.body?.campaignName),
    };
    const row = parsedFieldsToCampRow(parsedFields, defaults);
    const { validRows, invalidRows } = validateMappedImportRows([row]);
    if (!validRows.length) {
      throw new AppError(
        (invalidRows[0]?.errors || ['Invalid camp data']).join('. '),
        400,
        'VALIDATION_ERROR',
      );
    }
    const client = await resolveClientFromBody(
      { clientName: validRows[0].clientName || 'Unassigned' },
      { allowCreate: true },
    );
    const payload = campPayloadFromBody(
      { ...validRows[0], source: 'parser', clientName: client?.name || validRows[0].clientName },
      null,
      client,
    );
    const tracking = captureSubmissionTracking();
    const camp = await CampOpsCamp.create({
      ...payload,
      campId: await generateCampId(payload.campDate),
      status: 'pending_review',
      source: 'parser',
      createdById: actor(req).id,
      createdByEmail: actor(req).email,
      ...tracking,
    });
    res.status(201).json({
      data: withCampSchedule(camp),
      message: `Created camp ${camp.campId} from parser output`,
    });
  }),
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
