import { assignPreservingExisting, assertNotStale } from '../../store/dataIntegrity.js';
import { Router } from 'express';
import { authenticate, requirePermission, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { importAppError } from '../../utils/importErrors.js';
import { PERMISSIONS } from '../../config/constants.js';
import { writeAudit } from '../../utils/audit.js';
import { assertValidEmail, assertValidPhone } from '../../utils/identityNormalize.js';
import { sendExcel, sendCsv } from '../../utils/excelExport.js';
import { formatDate } from '../../utils/dateFormat.js';
import { cellValue, excelUpload, parseSheetRows, assertSpreadsheetUpload, discardUploadBuffer, sampleCsvFilename } from '../../utils/masterExcel.js';
import { importRateLimiter } from '../../middleware/importRateLimit.js';
import { executeUploadedImport } from '../imports/streaming/runStreamingImport.js';
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
  normalizeMasterBillingGstin,
  buildClientMasterBusinessKeyFilter,
  seedMasterBillingFromCompany,
  buildLegacyEmptyGstinMatchFilter,
} from './clientMaster.businessKey.js';
import { normalizeHealthcareWorkers } from './healthcareWorkers.js';
import {
  CampOpsCamp,
  CampOpsClient,
  CampOpsClientMaster,
  CampOpsCampaign,
  CampOpsImportTemplate,
  CampOpsExportTemplate,
} from './campOps.model.js';
import { LogisticsProduct, LogisticsUom, LogisticsExpenseSubCategory } from '../logistics/logistics.model.js';
import { Contact } from '../contacts/contact.model.js';
import { getHcwFinanceBlockers } from '../contacts/hcwFinanceReadiness.js';
import { resolveCampPayoutPayeeContact } from '../contacts/campPayoutPayee.js';
import { formatTextValue, getDoctorNameFormatError } from '../../utils/textFormat.js';
import {
  CAMP_FINANCE_EXPENSE_CATEGORY,
  CAMP_FINANCE_EXPENSE_SUB_CATEGORY,
  campFinanceExpenseDefaults,
} from './campFinanceExpense.js';
import {
  trimStr,
  formatCampTextPayload,
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
import { matchesExecutionFilter } from './campStageFilters.js';
import { resolveContactPersonFields } from './campContactPersons.js';
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
  enrichMappedImportRowsFromPin,
  normalizeImportSource,
} from './import/importRowEnrichment.js';
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
  assertExecutionConsumablesComplete,
  assertCanMarkCampExecuted,
  isExecutionReadyForFinance,
  normalizeLifecycleStage,
  promoteDueAssignedCampsToExecution,
  promoteAssignedCampToExecutionIfDue,
  EXECUTION_DOC_TYPES,
  EXECUTION_STATUS,
  resolveInTimeSelfieUrl,
  normalizePaymentSubmitStatus,
  PAYMENT_SUBMIT_STATUSES,
} from './campOps.lifecycle.js';
import {
  normalizeMappedConsumables,
  resolveMappedConsumablesForCamp,
} from './clientMasterConsumables.js';
import { resolveClientMasterPricingForCamp } from './campOps.clientMasterPricing.js';
import {
  assertCampSubmittedToFinance,
  buildCampFinanceExportRow,
  campFinanceExportFilename,
  campFinanceExportHeaders,
} from './campFinanceExport.js';
import {
  campFullExportHeaders,
  campFullExportRows,
  campFullExportSampleRow,
  resolveExportColumns,
} from './campFullExport.js';
import { CAMP_EXPORT_SECTIONS } from './campExportFieldSchema.js';
import {
  fetchCampsForExport,
  parseExportColumnKeys,
  parseExportFormat,
} from './campOps.export.js';
import { getRequestStageBlockers, assertRequestStageComplete } from './campOps.requestValidation.js';
import { assertHistoricalCampDatesAllowed } from './campDatePolicy.js';
import { assertHcwAssignmentGap } from './hcwAssignmentGap.js';
import {
  resolveCampClientScope,
  applyClientScopeToFilter,
  applyClientScopeToIdField,
  assertCampClientAccess,
  assertClientIdAccess,
  isClientIdInScope,
  parseAssignedUserEmails,
} from './campOps.clientAccess.js';
import {
  withRequestReview,
  applyRequestReviewTransition,
  persistRequestReviewOverdue,
} from './campOps.requestReview.js';
import {
  applyCampClosure,
  canCloseCampStatus,
  canCloseCampRecord,
  resolveClosureSelection,
} from './campOps.closure.js';
import { notifyCampWorkflow } from './campOps.notifications.js';
import { computeClientMasterPoBalanceMap } from '../finance/poUtilization.service.js';
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
import fs from 'fs';
import path from 'path';
import { uploadDir } from '../../config/paths.js';
import { signUploadFileUrl } from '../files/file.routes.js';
import { buildExecutionDocumentFileName } from './executionDocumentName.js';

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
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const allowed =
      mime.startsWith('image/')
      || mime === 'application/pdf'
      || mime.includes('spreadsheet')
      || mime.includes('excel')
      || mime === 'text/csv'
      || mime === 'application/msword'
      || mime.includes('wordprocessingml');
    cb(allowed ? null : new Error('File type not allowed for execution documents'), allowed);
  },
});

function signStoredUploadUrl(url) {
  const match = String(url || '').match(/\/uploads\/(.+)$/);
  if (!match) return url;
  return signUploadFileUrl(match[1]);
}

function withSignedCampFiles(camp) {
  const obj = { ...camp };
  if (Array.isArray(obj.executionDocuments)) {
    obj.executionDocuments = obj.executionDocuments.map((doc) => ({
      ...doc,
      url: signStoredUploadUrl(doc.url),
    }));
  }
  if (obj.inTimeSelfieUrl) {
    obj.inTimeSelfieUrl = signStoredUploadUrl(obj.inTimeSelfieUrl);
  }
  return obj;
}

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
  return withSignedCampFiles(obj);
}

/** Sort + page camps without filedb cloning the full match set. */
async function paginateCampsInMemory(filter, { page, limit, skip }, predicate = null) {
  const { loadCollection, matchDocument } = await import('../../store/filedb.js');
  const all = await loadCollection('camp_ops_camps');
  const matched = [];
  for (const camp of all) {
    if (!matchDocument(camp, filter)) continue;
    matched.push(camp);
  }
  matched.sort((a, b) => {
    const ad = String(a.campDate || '');
    const bd = String(b.campDate || '');
    if (ad !== bd) return bd.localeCompare(ad);
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });

  if (!predicate) {
    const total = matched.length;
    const data = matched.slice(skip, skip + limit).map((c) => enrichCamp({ ...c }));
    return paginated(data, total, page, limit);
  }

  const filtered = [];
  for (const camp of matched) {
    const enriched = enrichCamp({ ...camp });
    if (predicate(enriched)) filtered.push(enriched);
  }
  const total = filtered.length;
  return paginated(filtered.slice(skip, skip + limit), total, page, limit);
}

async function loadCampForUser(req, campId) {
  const camp = await CampOpsCamp.findOne({ _id: campId, isDeleted: false });
  if (!camp) throw new AppError('Camp not found', 404, 'NOT_FOUND');
  await assertCampClientAccess(req.user, camp);
  return camp;
}

async function scopeCampFilter(req, filter) {
  const scoped = await resolveCampClientScope(req.user);
  if (!scoped) return filter;
  return applyClientScopeToFilter(filter, scoped);
}

async function scopeEntityIdFilter(req, filter, field = '_id') {
  const scoped = await resolveCampClientScope(req.user);
  if (!scoped) return filter;
  return applyClientScopeToIdField(filter, scoped, field);
}

function sendCampExportResponse(res, camps, columnKeys, format) {
  const columns = resolveExportColumns(columnKeys);
  const headers = campFullExportHeaders(columns);
  const rows = campFullExportRows(camps, columns);
  const filename = format === 'csv' ? 'Camps_Export.csv' : 'Camps_Export.xlsx';
  if (format === 'csv') {
    sendCsv(res, filename, headers, rows);
    return;
  }
  sendExcel(res, filename, headers, rows, { sheetName: 'Camps' });
}


const router = Router();
router.use(authenticate);

const canRead = requirePermission(
  PERMISSIONS.CAMPS_READ,
  PERMISSIONS.CAMPS_REQUEST,
  PERMISSIONS.CAMPS_APPROVE
);
/** Client Master (brands + programs) — readable by Request One / Finance One for association */
const canReadClientMaster = requirePermission(
  PERMISSIONS.CAMPS_READ,
  PERMISSIONS.CAMPS_REQUEST,
  PERMISSIONS.CAMPS_APPROVE,
  PERMISSIONS.ASSET_REQUESTS_READ,
  PERMISSIONS.ASSET_REQUESTS_REQUEST,
  PERMISSIONS.ASSET_REQUESTS_APPROVE,
  PERMISSIONS.FINANCE_READ,
  PERMISSIONS.FINANCE_WRITE
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

function extractClientBilling(body = {}) {
  const billing = body.billing && typeof body.billing === 'object' ? body.billing : body;
  return {
    address: trimStr(billing.address ?? billing.billingAddress),
    gstin: trimStr(billing.gstin ?? billing.GSTIN).toUpperCase(),
    pan: trimStr(billing.pan ?? billing.panNumber).toUpperCase(),
    stateName: trimStr(billing.stateName ?? billing.state),
    stateCode: trimStr(billing.stateCode),
    contactPerson: trimStr(billing.contactPerson ?? billing.billingContact),
    email: trimStr(billing.email ?? billing.billingEmail).toLowerCase(),
    phone: trimStr(billing.phone ?? billing.billingPhone ?? billing.mobile),
  };
}

function hasClientBillingPayload(body = {}) {
  if (body.billing != null && typeof body.billing === 'object') return true;
  return [
    'address',
    'billingAddress',
    'gstin',
    'GSTIN',
    'pan',
    'panNumber',
    'stateName',
    'state',
    'stateCode',
    'contactPerson',
    'billingContact',
    'email',
    'billingEmail',
    'phone',
    'billingPhone',
    'mobile',
  ].some((key) => body[key] !== undefined);
}

function applyClientBilling(client, body = {}) {
  if (!client || !hasClientBillingPayload(body)) return false;
  const next = extractClientBilling(body);
  let changed = false;
  // Never treat blank payload fields as permission to erase existing billing data.
  for (const [key, value] of Object.entries(next)) {
    const current = String(client[key] || '');
    const incoming = String(value || '');
    if (!incoming && current) continue;
    if (current !== incoming) {
      client[key] = incoming;
      changed = true;
    }
  }
  return changed;
}

function clientBillingView(client) {
  if (!client) {
    return {
      address: '',
      gstin: '',
      pan: '',
      stateName: '',
      stateCode: '',
      contactPerson: '',
      email: '',
      phone: '',
    };
  }
  const row = client.toObject ? client.toObject() : client;
  return {
    address: trimStr(row.address),
    gstin: trimStr(row.gstin),
    pan: trimStr(row.pan),
    stateName: trimStr(row.stateName),
    stateCode: trimStr(row.stateCode),
    contactPerson: trimStr(row.contactPerson),
    email: trimStr(row.email),
    phone: trimStr(row.phone),
  };
}

/** Reject Dr./Doctor prefixes before formatting strips them. */
function assertRawDoctorName(body = {}) {
  if (body.doctorName === undefined || body.doctorName === null) return;
  const error = getDoctorNameFormatError(trimStr(body.doctorName));
  if (error) throw new AppError(error, 400, 'VALIDATION_ERROR');
}

async function resolveClientFromBody(body, { allowCreate = false, syncBilling = true } = {}) {
  const clientId = body.clientId || body.client;
  if (clientId) {
    const byId = await CampOpsClient.findOne({ _id: String(clientId), isDeleted: false });
    if (byId) {
      if (syncBilling && applyClientBilling(byId, body)) await byId.save();
      return byId;
    }
  }
  const name = formatTextValue(body.clientName, 'clientName');
  if (!name) return null;
  const existing = await CampOpsClient.findOne({ isDeleted: false, name });
  if (existing) {
    if (syncBilling && applyClientBilling(existing, body)) await existing.save();
    return existing;
  }
  if (!allowCreate) return null;
  const requestedCode = trimStr(body.clientCode).toUpperCase();
  const code = requestedCode || (await ensureUniqueClientCode(buildClientCode(name)));
  return CampOpsClient.create({
    name,
    code,
    isActive: true,
    ...(syncBilling ? extractClientBilling(body) : {}),
  });
}

function campPayloadFromBody(body, existing = null, client = null, options = {}) {
  const allowPartial = options.allowPartial === true;
  const schedule = resolveCampSchedule({
    startTime: body.startTime ?? existing?.startTime ?? '09:00',
    endTime: body.endTime ?? existing?.endTime ?? '',
    durationHours: body.durationHours ?? existing?.durationHours ?? 3,
  });

  const campDateRaw = body.campDate ?? existing?.campDate;
  const campDate = parseLocalDateInput(campDateRaw) || trimStr(campDateRaw);
  if (!campDate && !existing && !allowPartial) {
    throw new AppError('Camp date is required', 400, 'VALIDATION_ERROR');
  }

  const hospitalName = trimStr(
    body.hospitalName ?? body.clinicName ?? existing?.hospitalName ?? ''
  );
  const campAddress = trimStr(body.campAddress ?? existing?.campAddress) || hospitalName;

  return formatCampTextPayload({
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
    speciality: trimStr(body.speciality ?? existing?.speciality) || 'General Practitioner',
    hospitalName: campAddress ? '' : hospitalName,
    clinicName: '',
    campAddress,
    googlePlaceId: trimStr(body.googlePlaceId ?? existing?.googlePlaceId),
    addressManualEntry: body.addressManualEntry === true
      || (body.addressManualEntry === undefined && existing?.addressManualEntry === true),
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
    ...resolveContactPersonFields(body, existing),
    source: CAMP_OPS_SOURCES.includes(trimStr(body.source))
      ? trimStr(body.source)
      : existing?.source || 'dashboard',
    remarks: trimStr(body.remarks ?? existing?.remarks),
    ...lifecyclePayloadFromBody(body, existing, { pricing: options.pricing || null }),
  });
}

/* -------------------------------------------------------------------------- */
/* Consumables options (Product Master → Consumable)                          */
/* -------------------------------------------------------------------------- */

router.get(
  '/consumables/options',
  canRead,
  asyncHandler(async (_req, res) => {
    const [products, uoms] = await Promise.all([
      LogisticsProduct.find({ isDeleted: false, isActive: true, productType: 'Consumable' }).sort('name'),
      LogisticsUom.find({ isDeleted: false, isActive: true }).sort('name'),
    ]);
    const uomById = Object.fromEntries(
      uoms.map((uom) => [String(uom._id), trimStr(uom.name) || trimStr(uom.code)]),
    );
    res.json({
      data: products.map((product) => ({
        id: product._id,
        name: product.name,
        code: product.code,
        uomId: product.uomId || '',
        unit: uomById[String(product.uomId)] || '',
      })),
    });
  }),
);

router.get(
  '/consumables/for-camp',
  canRead,
  asyncHandler(async (req, res) => {
    const clientId = trimStr(req.query.clientId);
    const clientName = trimStr(req.query.clientName);
    if (!clientId && !clientName) throw new AppError('Client is required', 400, 'VALIDATION_ERROR');
    const data = await resolveMappedConsumablesForCamp(clientId, {
      campaignType: trimStr(req.query.campaignType),
      campaignName: trimStr(req.query.campaignName),
      clientName,
    });
    res.json({ data });
  }),
);

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

router.get(
  '/dashboard/stats',
  canRead,
  asyncHandler(async (req, res) => {
    const filter = await scopeCampFilter(req, buildCampFilter(req.query));
    const { scanCollection } = await import('../../store/filedb.js');

    const byStatus = Object.fromEntries(CAMP_OPS_STATUSES.map((s) => [s, 0]));
    let overdueNotExecuted = 0;
    let offHoursPending = 0;
    let weekendAttentionPending = 0;
    let total = 0;
    const brandCounts = new Map();
    const campaignCounts = new Map();
    const campaignNameCounts = new Map();
    const clientNameCounts = new Map();
    const stateCounts = new Map();
    const campaignTypeCounts = new Map();
    const monthlyMap = new Map();

    const bump = (map, key) => {
      if (key == null || key === '') return;
      const k = String(key);
      map.set(k, (map.get(k) || 0) + 1);
    };

    await scanCollection('camp_ops_camps', {
      filter,
      forEach: (camp) => {
        total += 1;
      byStatus[camp.status] = (byStatus[camp.status] || 0) + 1;
        if (camp.status === 'approved' && isCampOverdue(camp)) overdueNotExecuted += 1;
        if (camp.status === 'pending_review' && camp.submittedOffHours) offHoursPending += 1;
        if (camp.status === 'pending_review' && camp.submittedWeekendAttention) {
          weekendAttentionPending += 1;
        }
        bump(brandCounts, camp.clientId);
        bump(campaignCounts, camp.campaignId);
        bump(campaignNameCounts, camp.campaignName);
        bump(clientNameCounts, camp.clientName);
        if (trimStr(camp.state)) bump(stateCounts, camp.state);
        bump(campaignTypeCounts, camp.campaignType);
        const d = parseLocalDateInput(camp.campDate) || String(camp.campDate || '').slice(0, 10);
        if (d && d.length >= 7) bump(monthlyMap, d.slice(0, 7));
      },
    });

    const [clients, campaigns] = await Promise.all([
      CampOpsClient.find({ isDeleted: false }).sort('name').limit(500),
      CampOpsCampaign.find({ isDeleted: false }).sort('name').limit(500),
    ]);

    const brandBreakdown = clients
      .map((brand) => ({
        id: brand._id,
        label: brand.name,
        value: brandCounts.get(String(brand._id)) || 0,
      }))
      .filter((item) => item.value > 0);

    const campaignBreakdown = campaigns
      .map((item) => ({
        id: item._id,
        label: `${item.clientName || 'Brand'} — ${item.division || item.name}`,
        division: item.division || item.name,
        value:
          (campaignCounts.get(String(item._id)) || 0) +
          (campaignNameCounts.get(String(item.name)) || 0),
      }))
      .filter((entry) => entry.value > 0);

    const topFromMap = (map, n = 10) =>
      [...map.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, n);

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
        total,
        byStatus: {
          ...byStatus,
          overdue_not_executed: overdueNotExecuted,
        },
        alerts: {
          reaction_required: 0,
          off_hours_pending: offHoursPending,
          weekend_attention_pending: weekendAttentionPending,
        },
      },
      charts: {
        byClient: topFromMap(clientNameCounts, 10),
        byState: topFromMap(stateCounts, 10),
        byCampaignType: topFromMap(campaignTypeCounts, 50),
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
  asyncHandler(async (req, res) => {
    const filter = await scopeEntityIdFilter(req, { isDeleted: false }, '_id');
    const clients = await CampOpsClient.find(filter).sort('name');
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
    await promoteDueAssignedCampsToExecution();
    const { page, limit, skip } = parsePagination(req.query);
    const overdueOnly = req.query.overdue === '1' || req.query.overdue === 'true';
    const reactionRequired = req.query.reactionRequired === '1' || req.query.reactionRequired === 'true';
    const requestReviewStatus = trimStr(req.query.requestReviewStatus);
    const executionFilter = trimStr(req.query.executionFilter);
    const filter = await scopeCampFilter(req, buildCampFilter(req.query));

    if (reactionRequired) {
      return res.json(
        await paginateCampsInMemory(filter, { page, limit, skip }, (row) =>
          row.requestReviewStatus === 'information_requested'
        )
      );
    }

    if (requestReviewStatus) {
      return res.json(
        await paginateCampsInMemory(
          filter,
          { page, limit, skip },
          (row) => row.requestReviewStatus === requestReviewStatus
        )
      );
    }

    if (executionFilter) {
      return res.json(
        await paginateCampsInMemory(filter, { page, limit, skip }, (row) =>
          matchesExecutionFilter(row, executionFilter)
        )
      );
    }

    if (overdueOnly) {
      filter.status = 'approved';
      return res.json(
        await paginateCampsInMemory(filter, { page, limit, skip }, (row) => isCampOverdue(row))
      );
    }

    const [rows, total] = await Promise.all([
      CampOpsCamp.find(filter).sort('-campDate -createdAt').skip(skip).limit(limit),
      CampOpsCamp.countDocuments(filter),
    ]);
    res.json(paginated(rows.map(enrichCamp), total, page, limit));
  })
);

router.get(
  '/camps/export/fields',
  canRead,
  asyncHandler(async (_req, res) => {
    res.json({ data: { sections: CAMP_EXPORT_SECTIONS } });
  }),
);

router.get(
  '/camps/export/sample',
  canRead,
  asyncHandler(async (req, res) => {
    const columns = resolveExportColumns(parseExportColumnKeys(req.query.columns));
    const headers = campFullExportHeaders(columns);
    const rows = [campFullExportSampleRow(columns)];
    sendCsv(res, 'Camp_Download_Sample.csv', headers, rows);
  }),
);

router.get(
  '/camps/export/templates',
  canRead,
  asyncHandler(async (_req, res) => {
    const data = await CampOpsExportTemplate.find({ isDeleted: false }).sort('-updatedAt');
    res.json({ data });
  }),
);

router.post(
  '/camps/export/templates',
  canRequest,
  asyncHandler(async (req, res) => {
    const name = trimStr(req.body?.name);
    const columns = Array.isArray(req.body?.columns)
      ? req.body.columns.map((key) => String(key || '').trim()).filter(Boolean)
      : [];
    const filters = req.body?.filters && typeof req.body.filters === 'object' ? req.body.filters : {};
    const format = parseExportFormat(req.body?.format);
    if (!name) throw new AppError('Template name is required', 400, 'VALIDATION_ERROR');
    if (!columns.length) throw new AppError('Select at least one column', 400, 'VALIDATION_ERROR');
    const a = actor(req);
    const row = await CampOpsExportTemplate.create({
      name,
      columns,
      filters,
      format,
      createdById: a.id,
      createdByEmail: a.email,
    });
    res.status(201).json({ data: row });
  }),
);

router.delete(
  '/camps/export/templates/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await CampOpsExportTemplate.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Template not found', 404, 'NOT_FOUND');
    row.isDeleted = true;
    row.deletedAt = new Date().toISOString();
    await row.save();
    res.json({ data: { ok: true } });
  }),
);

router.post(
  '/camps/export',
  canRead,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const dateFrom = trimStr(body.dateFrom);
    const dateTo = trimStr(body.dateTo);
    if (!dateFrom && !dateTo) {
      throw new AppError('Select a camp date range before exporting', 400, 'VALIDATION_ERROR');
    }
    const filters = body.filters && typeof body.filters === 'object' ? body.filters : {};
    const query = { ...filters, dateFrom, dateTo };
    const columns = parseExportColumnKeys(body.columns);
    if (!columns.length) {
      throw new AppError('Select at least one export column', 400, 'VALIDATION_ERROR');
    }
    const format = parseExportFormat(body.format);
    const camps = await fetchCampsForExport(req, query, { scopeCampFilter });
    sendCampExportResponse(res, camps, columns, format);
  }),
);

router.get(
  '/camps/export',
  canRead,
  asyncHandler(async (req, res) => {
    // Keep lifecycle / stage filters so export matches the Manage table view.
    const query = { ...req.query };
    delete query.columns;
    delete query.format;
    const camps = await fetchCampsForExport(req, query, { scopeCampFilter });
    const columns = parseExportColumnKeys(req.query.columns);
    const format = parseExportFormat(req.query.format);
    sendCampExportResponse(res, camps, columns, format);
  }),
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
        const camp = await loadCampForUser(req, String(id));

        const before = camp.toObject();
        if (config.from && !config.from.includes(camp.status)) {
          throw new Error(`Camp ${camp.campId} is ${camp.status} and cannot be ${action}d`);
        }
        if (!canTransition(camp.status, config.nextStatus)) {
          throw new Error(`Camp ${camp.campId} cannot move to ${config.nextStatus}`);
        }

        camp.status = config.nextStatus;
        camp.lifecycleStage = normalizeLifecycleStage(camp.lifecycleStage, 'request');
        if (config.nextStatus === 'approved') {
          const blockers = getRequestStageBlockers(camp);
          if (blockers.length) throw new Error(blockers[0]);
          camp.approvedById = a.id;
          camp.approvedByEmail = a.email;
          applyRequestReviewTransition(camp, 'approve');
          if (camp.lifecycleStage === 'request') {
            camp.lifecycleStage = 'assignment';
          }
        }
        if (config.nextStatus === 'rejected') {
          const rejectionReason = trimStr(req.body?.rejectionReason || req.body?.remarks);
          if (!rejectionReason) throw new Error('Refusal reason is required');
          applyRequestReviewTransition(camp, 'reject', { reason: rejectionReason });
        }
        if (config.nextStatus === 'executed') {
          try {
            assertCanMarkCampExecuted(camp);
          } catch (err) {
            throw new Error(err.message || 'Cannot mark camp executed');
          }
          camp.executedById = a.id;
          camp.executedByEmail = a.email;
          camp.executedAt = new Date().toISOString();
          camp.executionStatus = EXECUTION_STATUS.CAMP_COMPLETED;
          camp.lifecycleStage = 'financial';
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
    const camp = await loadCampForUser(req, req.params.id);
    if (promoteAssignedCampToExecutionIfDue(camp)) {
      await camp.save();
    }
    const overdue = await persistRequestReviewOverdue(camp);
    if (overdue.becameOverdue) {
      await notifyCampWorkflow({ camp, action: 'review_overdue', actorId: null });
    }
    const enriched = enrichCamp(camp);
    if (enriched.isOverdue && camp.status === 'approved' && !camp.executionOverdueNotifiedAt) {
      camp.executionOverdueNotifiedAt = new Date().toISOString();
      await camp.save();
      await notifyCampWorkflow({ camp, action: 'execution_overdue', actorId: null });
    }
    res.json({ data: enriched });
  })
);

router.post(
  '/camps/:id/execution-documents',
  canRequest,
  campDocUpload.array('documents', 10),
  asyncHandler(async (req, res) => {
    const camp = await loadCampForUser(req, req.params.id);
    if (!canEditLifecycleStage(camp, 'execution')) {
      throw new AppError('Cannot upload execution documents for this camp', 400, 'VALIDATION_ERROR');
    }

    const docType = trimStr(req.body?.docType) || 'other';
    const docNote = trimStr(req.body?.docNote);
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
    const usedNames = existing.flatMap((doc) => [doc.fileName, doc.storedName]).filter(Boolean);
    const added = [];

    for (const [index, file] of files.entries()) {
      const { fileName: displayName, storedName } = buildExecutionDocumentFileName({
        doctorName: camp.doctorName,
        campDate: camp.campDate,
        docType,
        originalName: file.originalname,
        existingNames: usedNames,
        index,
        campScope: camp.campId || camp._id,
      });
      usedNames.push(displayName, storedName);

      const tempPath = path.join(campUploadRoot, file.filename);
      const finalPath = path.join(campUploadRoot, storedName);
      if (tempPath !== finalPath) {
        try {
          if (fs.existsSync(finalPath)) {
            // Only replace a file already owned by this camp's document set.
            const owned = existing.some((doc) => doc.storedName === storedName || doc.fileName === storedName);
            if (!owned) {
              throw new AppError(
                `Execution document name conflict for ${displayName}`,
                409,
                'UPLOAD_NAME_CONFLICT',
              );
            }
            fs.unlinkSync(finalPath);
          }
          fs.renameSync(tempPath, finalPath);
        } catch (err) {
          if (err instanceof AppError) throw err;
          throw new AppError(
            `Could not save execution document as ${displayName}`,
            500,
            'UPLOAD_RENAME_FAILED',
          );
        }
      }

      added.push({
        id: storedName,
        fileName: displayName,
        storedName,
        originalFileName: file.originalname,
      docType,
      ...(docNote ? { docNote } : {}),
      mimeType: file.mimetype,
      fileSize: file.size,
        url: `/uploads/camp-ops/${storedName}`,
      uploadedAt,
      });
    }

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

    assertRawDoctorName(req.body);
    const payload = campPayloadFromBody(req.body, null, resolved);
    try {
      assertRequestStageComplete({ ...payload, clientId: resolved._id, clientName: resolved.name });
    } catch (err) {
      throw new AppError(err.message || 'Complete all request stage fields', 400, 'VALIDATION_ERROR');
    }

    assertHistoricalCampDatesAllowed(req.user, req.permissions, {
      campDate: payload.campDate,
      requestDate: payload.requestDate,
    });
    await assertClientIdAccess(req.user, resolved._id);

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
    const camp = await loadCampForUser(req, req.params.id);

    // Normalize dirty title-cased stages from older saves before edit checks.
    camp.lifecycleStage = normalizeLifecycleStage(camp.lifecycleStage, 'request');
    const stage = normalizeLifecycleStage(
      trimStr(req.body.editingStage)
      || trimStr(req.body.lifecycleStage)
        || camp.lifecycleStage,
      'request',
    );
    const lifecycleOnly = req.body.lifecycleOnly === true;

    if (!canEditLifecycleStage(camp, stage)) {
      throw new AppError(`Cannot edit ${stage} stage for this camp`, 400, 'VALIDATION_ERROR');
    }

    const before = camp.toObject();
    let client = null;
    if (!lifecycleOnly && (req.body.clientId !== undefined || req.body.client !== undefined || req.body.clientName)) {
      client = await resolveClientFromBody(req.body, { allowCreate: false });
      if (!client) throw new AppError('Client not found', 404, 'NOT_FOUND');
      await assertClientIdAccess(req.user, client._id);
    }

    if (!lifecycleOnly && stage === 'request') {
      assertRawDoctorName(req.body);
    }
    const pricingClientId = client?._id || camp.clientId;
    const pricing = await resolveClientMasterPricingForCamp(pricingClientId, {
      campaignType: req.body.campaignType ?? camp.campaignType,
      campaignName: req.body.campaignName ?? camp.campaignName,
      clientName: client?.name || camp.clientName,
    });
    const payload = campPayloadFromBody(req.body, camp, client, { pricing });
    const executionOnlyKeys = [
      'executionStatus', 'chargeableStatus', 'inTime', 'outTime', 'kmRoundTrip', 'punctuality',
      'attire', 'labCoat', 'patientsCount', 'rxCount', 'cancellationReason', 'actualPatients',
    ];
    const financialOnlyKeys = [
      'paymentSubmitStatus', 'paymentRemark', 'financePaymentStatus', 'submittedToFinanceAt',
      'submittedToFinanceById', 'submittedToFinanceByEmail',
    ];
    if (stage === 'request' || stage === 'assignment') {
      executionOnlyKeys.forEach((key) => { delete payload[key]; });
    }
    if (stage !== 'financial') {
      financialOnlyKeys.forEach((key) => { delete payload[key]; });
    }

    if (stage === 'request' || !lifecycleOnly) {
      assertHistoricalCampDatesAllowed(
        req.user,
        req.permissions,
        {
          campDate: payload.campDate ?? camp.campDate,
          requestDate: payload.requestDate ?? camp.requestDate,
        },
        { existing: camp },
      );
    }

    assignPreservingExisting(camp, payload);

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

    // Same HCW, same date: next camp must start ≥ 1h30 after the previous camp ends.
    if (
      camp.assignmentDecision === 'assign'
      && trimStr(camp.hcwContactId)
      && !['cancelled', 'rejected'].includes(trimStr(camp.status))
    ) {
      try {
        await assertHcwAssignmentGap(camp);
      } catch (err) {
        throw new AppError(
          err.message || 'HCW schedule gap validation failed',
          409,
          err.code || 'HCW_ASSIGNMENT_GAP',
        );
      }
    }

    if (stage === 'execution') {
      const mappedConsumables = await resolveMappedConsumablesForCamp(camp.clientId, {
        campaignType: camp.campaignType,
        campaignName: camp.campaignName,
      });
      try {
        assertExecutionStageSave(camp);
        assertExecutionConsumablesComplete(camp, mappedConsumables);
      } catch (err) {
        throw new AppError(err.message || 'Invalid execution stage', 400, 'VALIDATION_ERROR');
      }
      if (isExecutionReadyForFinance(camp, mappedConsumables)) {
        camp.lifecycleStage = 'financial';
        if (camp.status === 'approved') {
          camp.status = 'executed';
        }
      }
    }

    if (camp.status === 'approved' && normalizeLifecycleStage(camp.lifecycleStage, 'request') === 'request') {
      camp.lifecycleStage = 'assignment';
    }
    if (
      camp.status === 'executed'
      && ['request', 'assignment', 'execution'].includes(normalizeLifecycleStage(camp.lifecycleStage, 'request'))
    ) {
      camp.lifecycleStage = 'financial';
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
    const camp = await loadCampForUser(req, req.params.id);
    camp.lifecycleStage = normalizeLifecycleStage(camp.lifecycleStage, 'request');
    if (!canEditLifecycleStage(camp, 'financial')) {
      throw new AppError('Financial stage is not editable for this camp', 400, 'VALIDATION_ERROR');
    }
    if (camp.submittedToFinanceAt) {
      throw new AppError('This camp payout was already submitted to Finance One', 400, 'ALREADY_SUBMITTED');
    }

    const before = camp.toObject();
    const pricing = await resolveClientMasterPricingForCamp(camp.clientId, {
      campaignType: req.body.campaignType ?? camp.campaignType,
      campaignName: req.body.campaignName ?? camp.campaignName,
      clientName: camp.clientName,
    });
    const payload = lifecyclePayloadFromBody(req.body, camp, { pricing });
    assignPreservingExisting(camp, payload);

    const paymentSubmitStatus = normalizePaymentSubmitStatus(
      req.body.paymentSubmitStatus || camp.paymentSubmitStatus
    );
    if (!paymentSubmitStatus) {
      throw new AppError(
        'Select Validation Completed, Validation Pending, or Payment On Hold before submitting',
        400,
        'VALIDATION_ERROR'
      );
    }
    if (!PAYMENT_SUBMIT_STATUSES.includes(paymentSubmitStatus)) {
      throw new AppError('Invalid payment submit status', 400, 'VALIDATION_ERROR');
    }

    const hcwContactId = camp.hcwContactId || payload.hcwContactId;
    if (!hcwContactId) {
      throw new AppError('Assign a healthcare worker before submitting to Finance', 400, 'VALIDATION_ERROR');
    }
    const payeeResolved = await resolveCampPayoutPayeeContact(hcwContactId);
    if (!payeeResolved.assignedContact && !String(hcwContactId).startsWith('spe:')) {
      throw new AppError('Assigned healthcare worker was not found in Contact Directory', 400, 'VALIDATION_ERROR');
    }
    if (payeeResolved.payeeIsServiceProvider && !payeeResolved.payeeContact) {
      throw new AppError(
        'Service Provider profile is missing in Contact Directory for this assignment',
        400,
        'VALIDATION_ERROR',
      );
    }
    const payeeContact = payeeResolved.payeeContact || payeeResolved.assignedContact;
    const payeeLabel = payeeResolved.payeeIsServiceProvider ? 'Service Provider' : 'HCW';
    const hcwBlockers = getHcwFinanceBlockers(payeeContact, { label: payeeLabel });
    if (hcwBlockers.length) {
      throw new AppError(
        `Complete ${payeeLabel} profile before Finance submit: ${hcwBlockers.join('; ')}`,
        400,
        'VALIDATION_ERROR',
      );
    }

    const a = actor(req);
    const now = new Date().toISOString();
    camp.paymentSubmitStatus = paymentSubmitStatus;
    camp.financePaymentStatus = 'under_review';
    camp.submittedToFinanceAt = now;
    camp.submittedToFinanceById = a.id;
    camp.submittedToFinanceByEmail = a.email;
    camp.lifecycleStage = 'financial';

    const expenseDefaults = campFinanceExpenseDefaults();
    camp.expenseCategory = expenseDefaults.expenseCategory;
    camp.expenseSubCategory = expenseDefaults.expenseSubCategory;
    const expenseSub = await LogisticsExpenseSubCategory.findOne({
      isDeleted: false,
      isActive: true,
      name: CAMP_FINANCE_EXPENSE_SUB_CATEGORY,
      categoryName: CAMP_FINANCE_EXPENSE_CATEGORY,
    });
    camp.expenseSubCategoryId = expenseSub?._id || null;

    await camp.save();
    await audit(req, 'camp_ops.submit_to_finance', 'camp_ops_camp', camp._id, before, camp.toObject());
    res.json({ data: enrichCamp(camp) });
  })
);

router.get(
  '/camps/:id/finance-export',
  canRead,
  asyncHandler(async (req, res) => {
    const camp = await loadCampForUser(req, req.params.id);
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
  const camp = await loadCampForUser(req, req.params.id);
  camp.lifecycleStage = normalizeLifecycleStage(camp.lifecycleStage, 'request');
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
    if (normalizeLifecycleStage(camp.lifecycleStage, 'request') === 'request') {
      camp.lifecycleStage = 'assignment';
    }
  }
  if (nextStatus === 'rejected') {
    const rejectionReason = trimStr(req.body?.rejectionReason || req.body?.remarks);
    if (!rejectionReason) {
      throw new AppError('Refusal reason is required', 400, 'VALIDATION_ERROR');
    }
    applyRequestReviewTransition(camp, 'reject', { reason: rejectionReason });
  }
  if (nextStatus === 'executed') {
    try {
      assertCanMarkCampExecuted(camp);
    } catch (err) {
      throw new AppError(err.message || 'Cannot mark camp executed', 400, 'VALIDATION_ERROR');
    }
    camp.executedById = a.id;
    camp.executedByEmail = a.email;
    camp.executedAt = new Date().toISOString();
    camp.lifecycleStage = 'financial';
    camp.executionStatus = EXECUTION_STATUS.CAMP_COMPLETED;
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
    const camp = await loadCampForUser(req, req.params.id);
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
    const camp = await loadCampForUser(req, req.params.id);
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
    const reasonCategory = trimStr(req.body?.reasonCategory || req.body?.closureReasonCategory);
    const subReason = trimStr(
      req.body?.subReason || req.body?.reasonCode || req.body?.closureReasonCode,
    );
    const closureRemarks = trimStr(req.body?.closureRemarks || req.body?.remarks);

    try {
      resolveClosureSelection({
        closureType,
        reasonCategory,
        subReason,
        camp,
      });
    } catch (err) {
      throw new AppError(err.message || 'Invalid closure details', 400, 'VALIDATION_ERROR');
    }

    const before = camp.toObject();
    try {
      applyCampClosure(camp, {
        closureType,
        reasonCategory,
        subReason,
        closureRemarks,
        chargeableStatus: trimStr(req.body?.chargeableStatus),
        actor: actor(req),
      });
    } catch (err) {
      throw new AppError(err.message || 'Invalid closure details', 400, 'VALIDATION_ERROR');
    }
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
  canReadClientMaster,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = await scopeEntityIdFilter(req, { isDeleted: false }, '_id');
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
  canReadClientMaster,
  asyncHandler(async (req, res) => {
    await assertClientIdAccess(req.user, req.params.id);
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
      ...extractClientBilling(req.body),
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
    applyClientBilling(client, req.body);
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
  'campDuration',
  'billingAddress',
  'billingGstin',
  'billingPan',
  'billingStateName',
  'billingStateCode',
  'spocName',
  'spocNumber',
  'spocEmail',
  'requestTimeline',
  'campTerms',
  'poNumber',
  'poIssueDate',
  'poExpiryDate',
  'agreementStartDate',
  'agreementEffectiveDate',
  'agreementEndDate',
];
const MASTER_NUMERIC_FIELDS = [
  'executedCampUnit',
  'cancelledCampUnit',
  'otUnit',
  'minimumPatientCovered',
  'minimumKmsCovered',
  'extPatientUnit',
  'kmsUnit',
];

/**
 * Billing for a Client Master row. Row fields win; company billing is legacy fallback only.
 */
function masterBillingView(row = {}, client = null) {
  const company = clientBillingView(client);
  return {
    address: trimStr(row.billingAddress) || company.address,
    gstin: normalizeMasterBillingGstin(row.billingGstin) || company.gstin,
    pan: trimStr(row.billingPan).toUpperCase() || company.pan,
    stateName: trimStr(row.billingStateName) || company.stateName,
    stateCode: trimStr(row.billingStateCode) || company.stateCode,
    contactPerson: trimStr(row.spocName) || company.contactPerson,
    email: trimStr(row.spocEmail).split(',')[0]?.trim().toLowerCase() || company.email,
    phone: trimStr(row.spocNumber) || company.phone,
  };
}

/** Map body.billing / flat aliases onto per-row billing fields (never onto the company). */
function applyMasterBillingFields(payload, body = {}) {
  const nested = body.billing && typeof body.billing === 'object' ? body.billing : {};
  const read = (...keys) => {
    for (const key of keys) {
      if (body[key] !== undefined) return body[key];
      if (nested[key] !== undefined) return nested[key];
    }
    return undefined;
  };

  const address = read('billingAddress', 'address');
  const gstin = read('billingGstin', 'gstin', 'GSTIN');
  const pan = read('billingPan', 'pan', 'panNumber');
  const stateName = read('billingStateName', 'stateName', 'state');
  const stateCode = read('billingStateCode', 'stateCode');

  if (address !== undefined) payload.billingAddress = trimStr(address);
  if (gstin !== undefined) payload.billingGstin = normalizeMasterBillingGstin(gstin);
  if (pan !== undefined) payload.billingPan = trimStr(pan).toUpperCase();
  if (stateName !== undefined) payload.billingStateName = trimStr(stateName);
  if (stateCode !== undefined) payload.billingStateCode = trimStr(stateCode);
}

/**
 * Backend uniqueness: Client + GSTIN + Division + Method must not repeat.
 */
async function assertClientMasterBusinessKeyUnique({
  clientId,
  billingGstin,
  programName,
  campName,
  excludeId = null,
} = {}) {
  const clash = await CampOpsClientMaster.findOne(
    buildClientMasterBusinessKeyFilter({
      clientId,
      billingGstin,
      programName,
      campName,
      excludeId,
    })
  );
  if (clash) {
    throw new AppError(
      'A Client Master record already exists for this Client + GSTIN + Division + Method combination',
      409,
      'DUPLICATE_CLIENT_MASTER_KEY'
    );
  }
}

const CAMP_TERMS_VALUES = new Set(['none', 'po_based', 'agreement_based', 'approval_based']);

function normalizeCampTermsValue(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (raw === 'po' || raw === 'po_based' || raw === 'pobased') return 'po_based';
  if (raw === 'agreement' || raw === 'agreement_based' || raw === 'agreementbased') {
    return 'agreement_based';
  }
  if (raw === 'approval' || raw === 'approval_based' || raw === 'approvalbased') {
    return 'approval_based';
  }
  if (CAMP_TERMS_VALUES.has(raw)) return raw;
  return 'none';
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function computePoTaxFields(enteredAmount, applyGst18) {
  const entered = roundMoney(enteredAmount);
  // When GST is on, entered amount is GST-inclusive (gross).
  // Example: 5500 → Net 4661.02, GST 838.98.
  if (!applyGst18) {
    return { poNetValue: entered, poApplyGst18: false, poGstAmount: 0, poGrossValue: entered };
  }
  const gross = entered;
  const net = roundMoney(gross / 1.18);
  const gst = roundMoney(gross - net);
  return {
    poNetValue: net,
    poApplyGst18: true,
    poGstAmount: gst,
    poGrossValue: gross,
  };
}

function newPoId() {
  return `po-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function newCampTermsFileId() {
  return `ctf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCampTermsFile(doc, fallbackId) {
  if (!doc?.storedName && !doc?.fileName) return null;
  return {
    id: trimStr(doc.id || doc._id) || fallbackId || newCampTermsFileId(),
    fileName: doc.fileName || doc.originalFileName || 'Attachment',
    storedName: doc.storedName || '',
    mimeType: doc.mimeType || 'application/octet-stream',
    fileSize: doc.fileSize || 0,
    url: doc.url || (doc.storedName ? `/uploads/camp-ops/${doc.storedName}` : ''),
    uploadedAt: doc.uploadedAt || null,
  };
}

function collectCampTermsFiles(rowLike, bodyFiles) {
  if (Array.isArray(bodyFiles)) {
    return bodyFiles.map((doc, i) => normalizeCampTermsFile(doc, `ctf-${i + 1}`)).filter(Boolean);
  }
  const plain = rowLike?.toObject ? rowLike.toObject() : { ...rowLike };
  if (Array.isArray(plain.campTermsFiles) && plain.campTermsFiles.length) {
    return plain.campTermsFiles.map((doc, i) => normalizeCampTermsFile(doc, `ctf-${i + 1}`)).filter(Boolean);
  }
  const fromOrders = [];
  if (Array.isArray(plain.purchaseOrders)) {
    for (const po of plain.purchaseOrders) {
      if (Array.isArray(po?.files) && po.files.length) {
        for (const file of po.files) {
          const normalized = normalizeCampTermsFile(file);
          if (normalized) fromOrders.push(normalized);
        }
      } else {
        const file = normalizeCampTermsFile(po?.poFile);
        if (file) fromOrders.push(file);
      }
    }
  }
  if (fromOrders.length) return fromOrders;
  const legacy = normalizeCampTermsFile(plain.poFile);
  return legacy ? [legacy] : [];
}

function inferCampTerms(plain) {
  if (plain.campTerms) return normalizeCampTermsValue(plain.campTerms);
  if (
    Array.isArray(plain.purchaseOrders) && plain.purchaseOrders.length
    || plain.poNumber
    || plain.poNetValue
    || plain.poFile?.storedName
    || plain.poApplyGst18
    || plain.poIssueDate
    || plain.poExpiryDate
  ) {
    return 'po_based';
  }
  if (plain.agreementStartDate || plain.agreementEffectiveDate || plain.agreementEndDate) {
    return 'agreement_based';
  }
  if (Array.isArray(plain.campTermsFiles) && plain.campTermsFiles.length) {
    return 'approval_based';
  }
  return 'none';
}

function normalizePurchaseOrderRow(row, index, existingById = new Map()) {
  const id = trimStr(row?.id || row?._id) || newPoId();
  const existing = existingById.get(id);
  const apply =
    row?.poApplyGst18 === true
    || row?.poApplyGst18 === 'true'
    || row?.poApplyGst18 === 1
    || (row?.poApplyGst18 === undefined && Boolean(existing?.poApplyGst18));

  let entered = 0;
  if (apply) {
    const gross = Number(row?.poGrossValue);
    const net = Number(row?.poNetValue);
    const gst = Number(row?.poGstAmount);
    if (Number.isFinite(gross) && gross > 0) {
      if (Number.isFinite(net) && Number.isFinite(gst) && Math.abs(gross - roundMoney(net + gst)) <= 0.02) {
        entered = gross;
      } else if (Number.isFinite(net) && Math.abs(gross - net) <= 0.02 && Number.isFinite(gst) && gst > 0) {
        entered = roundMoney(net + gst);
      } else {
        entered = gross;
      }
    } else if (Number.isFinite(net) && Number.isFinite(gst) && gst > 0) {
      entered = roundMoney(net + gst);
    } else if (Number.isFinite(net)) {
      entered = net;
    } else if (existing) {
      const eg = Number(existing.poGrossValue);
      entered = Number.isFinite(eg) && eg > 0 ? eg : Number(existing.poNetValue) || 0;
    }
  } else {
    const net = Number(row?.poNetValue);
    entered = Number.isFinite(net) ? net : Number(existing?.poNetValue) || 0;
  }

  const tax = computePoTaxFields(entered, apply);

  let files = [];
  if (Array.isArray(row?.files) && row.files.length > 0) {
    files = row.files.map((doc, i) => normalizeCampTermsFile(doc, `${id}-f-${i + 1}`)).filter(Boolean);
  } else if (row?.poFile?.storedName) {
    const single = normalizeCampTermsFile(row.poFile, `${id}-f-1`);
    if (single) files = [single];
  } else if (Array.isArray(existing?.files) && existing.files.length) {
    files = existing.files.map((doc, i) => normalizeCampTermsFile(doc, `${id}-f-${i + 1}`)).filter(Boolean);
  } else if (existing?.poFile?.storedName) {
    const single = normalizeCampTermsFile(existing.poFile, `${id}-f-1`);
    if (single) files = [single];
  }

  const poIssueDate =
    row?.poIssueDate !== undefined
      ? trimStr(row.poIssueDate).slice(0, 10)
      : trimStr(existing?.poIssueDate).slice(0, 10);
  const poExpiryDate =
    row?.poExpiryDate !== undefined
      ? trimStr(row.poExpiryDate).slice(0, 10)
      : trimStr(existing?.poExpiryDate).slice(0, 10);

  return {
    id,
    poNumber: trimStr(row?.poNumber).slice(0, 80),
    ...tax,
    poIssueDate,
    poExpiryDate,
    files,
    poFile: files[0] || null,
    _index: index,
  };
}

function combinePurchaseOrders(orders = []) {
  let net = 0;
  let gst = 0;
  let gross = 0;
  for (const row of orders) {
    net += Number(row.poNetValue) || 0;
    gst += Number(row.poGstAmount) || 0;
    gross += Number(row.poGrossValue) || 0;
  }
  return {
    poCombinedNet: roundMoney(net),
    poCombinedGst: roundMoney(gst),
    poCombinedGross: roundMoney(gross),
  };
}

/** Normalize camp terms + legacy PO mirrors for API responses. */
function ensurePurchaseOrders(rowLike) {
  const plain = rowLike?.toObject ? rowLike.toObject() : { ...rowLike };
  const campTerms = inferCampTerms(plain);
  const campTermsFiles = collectCampTermsFiles(plain);
  let orders = Array.isArray(plain.purchaseOrders) ? plain.purchaseOrders.filter(Boolean) : [];
  if (!orders.length && (plain.poNumber || plain.poNetValue || plain.poFile?.storedName || plain.poApplyGst18)) {
    const tax = computePoTaxFields(Number(plain.poNetValue) || 0, Boolean(plain.poApplyGst18));
    const files = campTermsFiles.length
      ? campTermsFiles
      : (plain.poFile ? [normalizeCampTermsFile(plain.poFile)].filter(Boolean) : []);
    orders = [
      {
        id: 'po-legacy-0',
        poNumber: trimStr(plain.poNumber),
        ...tax,
        poIssueDate: trimStr(plain.poIssueDate).slice(0, 10),
        poExpiryDate: trimStr(plain.poExpiryDate).slice(0, 10),
        files,
        poFile: files[0] || plain.poFile || null,
      },
    ];
  }
  const combined = combinePurchaseOrders(orders);
  const first = orders[0] || null;
  return {
    ...plain,
    campTerms,
    campTermsFiles: campTerms === 'po_based'
      ? (Array.isArray(plain.campTermsFiles) && plain.campTermsFiles.length ? campTermsFiles : collectCampTermsFiles({ purchaseOrders: orders }))
      : campTermsFiles,
    purchaseOrders: orders.map((po, index) => {
      const files = Array.isArray(po.files) && po.files.length
        ? po.files.map((doc, i) => normalizeCampTermsFile(doc, `${po.id || index}-f-${i + 1}`)).filter(Boolean)
        : (po.poFile ? [normalizeCampTermsFile(po.poFile)].filter(Boolean) : []);
      return {
        ...po,
        poIssueDate: trimStr(po.poIssueDate || (index === 0 ? plain.poIssueDate : '')).slice(0, 10),
        poExpiryDate: trimStr(po.poExpiryDate || (index === 0 ? plain.poExpiryDate : '')).slice(0, 10),
        files,
        poFile: files[0] || po.poFile || null,
      };
    }),
    ...combined,
    poNumber: plain.poNumber || first?.poNumber || '',
    poNetValue: plain.poNetValue ?? first?.poNetValue ?? 0,
    poApplyGst18: plain.poApplyGst18 ?? Boolean(first?.poApplyGst18),
    poGstAmount: plain.poGstAmount ?? first?.poGstAmount ?? 0,
    poGrossValue: plain.poGrossValue ?? first?.poGrossValue ?? 0,
    poIssueDate: plain.poIssueDate || first?.poIssueDate || '',
    poExpiryDate: plain.poExpiryDate || first?.poExpiryDate || '',
    poFile: plain.poFile || first?.poFile || campTermsFiles[0] || null,
    agreementStartDate: plain.agreementStartDate || '',
    agreementEffectiveDate: plain.agreementEffectiveDate || '',
    agreementEndDate: plain.agreementEndDate || '',
  };
}

function withSignedPoFile(row) {
  const plain = ensurePurchaseOrders(row);
  if (Array.isArray(plain.campTermsFiles)) {
    plain.campTermsFiles = plain.campTermsFiles.map((file) => {
      if (!file?.url) return file;
      return { ...file, url: signStoredUploadUrl(file.url) };
    });
  }
  if (Array.isArray(plain.purchaseOrders)) {
    plain.purchaseOrders = plain.purchaseOrders.map((po) => {
      const files = (Array.isArray(po.files) ? po.files : [])
        .map((file) => {
          if (!file?.url) return file;
          return { ...file, url: signStoredUploadUrl(file.url) };
        })
        .filter(Boolean);
      const poFile = files[0] || po.poFile;
      return {
        ...po,
        files,
        poFile: poFile?.url
          ? { ...poFile, url: signStoredUploadUrl(poFile.url) }
          : poFile || null,
      };
    });
  }
  if (plain.poFile?.url) {
    plain.poFile = {
      ...plain.poFile,
      url: signStoredUploadUrl(plain.poFile.url),
    };
  }
  return plain;
}

function applyCampTermsToPayload(payload, body, existingRow = null) {
  const existing = ensurePurchaseOrders(existingRow || {});
  const campTerms =
    body.campTerms !== undefined
      ? normalizeCampTermsValue(body.campTerms)
      : existing.campTerms || 'none';

  const existingFiles = collectCampTermsFiles(existing);
  const files =
    body.campTermsFiles !== undefined
      ? collectCampTermsFiles(existing, body.campTermsFiles)
      : existingFiles;

  payload.campTerms = campTerms;
  payload.campTermsFiles = campTerms === 'none' ? [] : files;

  if (campTerms === 'po_based') {
    const existingById = new Map(
      (existing.purchaseOrders || []).map((po) => [String(po.id), po])
    );

    let orders;
    if (Array.isArray(body.purchaseOrders)) {
      orders = body.purchaseOrders
        .map((row, index) => normalizePurchaseOrderRow(row, index, existingById))
        .filter(
          (row) =>
            row.poNumber
            || row.poNetValue > 0
            || row.poFile?.storedName
            || (Array.isArray(row.files) && row.files.length)
            || row.poIssueDate
            || row.poExpiryDate
        )
        .map(({ _index, ...rest }) => rest);
    } else {
      const apply =
        body.poApplyGst18 !== undefined
          ? body.poApplyGst18 === true || body.poApplyGst18 === 'true' || body.poApplyGst18 === 1
          : Boolean(existing.poApplyGst18);
      const grossFromBody = body.poGrossValue !== undefined ? Number(body.poGrossValue) : NaN;
      const netFromBody = body.poNetValue !== undefined ? Number(body.poNetValue) : NaN;
      const gstFromBody = body.poGstAmount !== undefined ? Number(body.poGstAmount) : NaN;
      let entered = 0;
      if (apply) {
        if (Number.isFinite(grossFromBody) && grossFromBody > 0) entered = grossFromBody;
        else if (Number.isFinite(netFromBody) && Number.isFinite(gstFromBody) && gstFromBody > 0) {
          entered = roundMoney(netFromBody + gstFromBody);
        } else if (Number.isFinite(netFromBody)) entered = netFromBody;
        else {
          const eg = Number(existing.poGrossValue);
          entered = Number.isFinite(eg) && eg > 0 ? eg : Number(existing.poNetValue) || 0;
        }
      } else if (Number.isFinite(netFromBody)) {
        entered = netFromBody;
      } else {
        entered = Number(existing.poNetValue) || 0;
      }
      const tax = computePoTaxFields(entered, apply);
      const poNumber =
        body.poNumber !== undefined ? trimStr(body.poNumber).slice(0, 80) : trimStr(existing.poNumber);
      const poIssueDate =
        body.poIssueDate !== undefined
          ? trimStr(body.poIssueDate).slice(0, 10)
          : trimStr(existing.poIssueDate).slice(0, 10);
      const poExpiryDate =
        body.poExpiryDate !== undefined
          ? trimStr(body.poExpiryDate).slice(0, 10)
          : trimStr(existing.poExpiryDate).slice(0, 10);
      const primaryFiles = files.length
        ? files
        : (existing.purchaseOrders?.[0]?.files || []).map((doc) => normalizeCampTermsFile(doc)).filter(Boolean);
      orders = [
        {
          id: existing.purchaseOrders?.[0]?.id || 'po-primary',
          poNumber,
          ...tax,
          poIssueDate,
          poExpiryDate,
          files: primaryFiles,
          poFile: primaryFiles[0] || null,
        },
      ];
    }

    if (!orders.length) {
      orders = [
        normalizePurchaseOrderRow(
          {
            id: 'po-primary',
            poNumber: '',
            poNetValue: 0,
            poApplyGst18: false,
            poIssueDate: '',
            poExpiryDate: '',
            files: [],
          },
          0,
          existingById
        ),
      ].map(({ _index, ...rest }) => rest);
    }

    const combined = combinePurchaseOrders(orders);
    const primary = orders[0];
    const flatFiles = orders.flatMap((row) =>
      (Array.isArray(row.files) && row.files.length
        ? row.files
        : row.poFile
          ? [row.poFile]
          : []
      ).map((doc) => normalizeCampTermsFile(doc)).filter(Boolean)
    );

    const agreementStartDate =
      body.agreementStartDate !== undefined
        ? trimStr(body.agreementStartDate).slice(0, 10)
        : trimStr(existing.agreementStartDate).slice(0, 10);
    const agreementEffectiveDate =
      body.agreementEffectiveDate !== undefined
        ? trimStr(body.agreementEffectiveDate).slice(0, 10)
        : trimStr(existing.agreementEffectiveDate).slice(0, 10);
    const agreementEndDate =
      body.agreementEndDate !== undefined
        ? trimStr(body.agreementEndDate).slice(0, 10)
        : trimStr(existing.agreementEndDate).slice(0, 10);
    // Keep agreement uploads separate from PO row files when the client sends them.
    const agreementFiles = body.campTermsFiles !== undefined
      ? files
      : collectCampTermsFiles({
        campTermsFiles: existing.campTermsFiles,
      });

    Object.assign(payload, {
      poNumber: primary.poNumber || '',
      poNetValue: primary.poNetValue ?? 0,
      poApplyGst18: Boolean(primary.poApplyGst18),
      poGstAmount: primary.poGstAmount ?? 0,
      poGrossValue: primary.poGrossValue ?? 0,
      poIssueDate: primary.poIssueDate || '',
      poExpiryDate: primary.poExpiryDate || '',
      ...combined,
      poFile: primary.poFile || flatFiles[0] || null,
      purchaseOrders: orders,
      campTermsFiles: agreementFiles.length ? agreementFiles : existingFiles,
      agreementStartDate,
      agreementEffectiveDate,
      agreementEndDate,
    });
    return;
  }

  if (campTerms === 'agreement_based' || campTerms === 'approval_based') {
    // Preserve PO rows/details when Agreement/Approval is the active type.
    let orders = existing.purchaseOrders || [];
    if (Array.isArray(body.purchaseOrders)) {
      const existingById = new Map(
        (existing.purchaseOrders || []).map((po) => [String(po.id), po])
      );
      orders = body.purchaseOrders
        .map((row, index) => normalizePurchaseOrderRow(row, index, existingById))
        .filter(
          (row) =>
            row.poNumber
            || row.poNetValue > 0
            || row.poFile?.storedName
            || (Array.isArray(row.files) && row.files.length)
            || row.poIssueDate
            || row.poExpiryDate
        )
        .map(({ _index, ...rest }) => rest);
    }
    const combined = combinePurchaseOrders(orders);
    const primary = orders[0] || null;
    Object.assign(payload, {
      agreementStartDate:
        body.agreementStartDate !== undefined
          ? trimStr(body.agreementStartDate).slice(0, 10)
          : trimStr(existing.agreementStartDate).slice(0, 10),
      agreementEffectiveDate:
        body.agreementEffectiveDate !== undefined
          ? trimStr(body.agreementEffectiveDate).slice(0, 10)
          : trimStr(existing.agreementEffectiveDate).slice(0, 10),
      agreementEndDate:
        body.agreementEndDate !== undefined
          ? trimStr(body.agreementEndDate).slice(0, 10)
          : trimStr(existing.agreementEndDate).slice(0, 10),
      poNumber: primary?.poNumber || trimStr(existing.poNumber),
      poNetValue: primary?.poNetValue ?? (Number(existing.poNetValue) || 0),
      poApplyGst18: primary
        ? Boolean(primary.poApplyGst18)
        : Boolean(existing.poApplyGst18),
      poGstAmount: primary?.poGstAmount ?? (Number(existing.poGstAmount) || 0),
      poGrossValue: primary?.poGrossValue ?? (Number(existing.poGrossValue) || 0),
      poIssueDate: primary?.poIssueDate || trimStr(existing.poIssueDate).slice(0, 10),
      poExpiryDate: primary?.poExpiryDate || trimStr(existing.poExpiryDate).slice(0, 10),
      ...combined,
      poFile: primary?.poFile || existing.poFile || null,
      purchaseOrders: orders,
    });
    return;
  }

  // none — keep previously entered PO/Agreement details so users can switch back.
  Object.assign(payload, {
    agreementStartDate:
      body.agreementStartDate !== undefined
        ? trimStr(body.agreementStartDate).slice(0, 10)
        : trimStr(existing.agreementStartDate).slice(0, 10),
    agreementEffectiveDate:
      body.agreementEffectiveDate !== undefined
        ? trimStr(body.agreementEffectiveDate).slice(0, 10)
        : trimStr(existing.agreementEffectiveDate).slice(0, 10),
    agreementEndDate:
      body.agreementEndDate !== undefined
        ? trimStr(body.agreementEndDate).slice(0, 10)
        : trimStr(existing.agreementEndDate).slice(0, 10),
    poNumber: trimStr(existing.poNumber),
    poNetValue: Number(existing.poNetValue) || 0,
    poApplyGst18: Boolean(existing.poApplyGst18),
    poGstAmount: Number(existing.poGstAmount) || 0,
    poGrossValue: Number(existing.poGrossValue) || 0,
    poIssueDate: trimStr(existing.poIssueDate).slice(0, 10),
    poExpiryDate: trimStr(existing.poExpiryDate).slice(0, 10),
    poCombinedNet: Number(existing.poCombinedNet) || 0,
    poCombinedGst: Number(existing.poCombinedGst) || 0,
    poCombinedGross: Number(existing.poCombinedGross) || 0,
    poFile: existing.poFile || null,
    purchaseOrders: Array.isArray(body.purchaseOrders)
      ? body.purchaseOrders
      : (existing.purchaseOrders || []),
    campTermsFiles: body.campTermsFiles !== undefined ? files : existingFiles,
  });
}

function applyPurchaseOrdersToPayload(payload, body, existingRow = null) {
  // Prefer campTerms when provided by the new Client Master form.
  if (body.campTerms !== undefined || body.campTermsFiles !== undefined) {
    applyCampTermsToPayload(payload, body, existingRow);
    return;
  }

  if (body.purchaseOrders === undefined) {
    if (body.poApplyGst18 !== undefined || body.poNetValue !== undefined || body.poNumber !== undefined) {
      applyCampTermsToPayload(
        payload,
        {
          campTerms: 'po_based',
          poNumber: body.poNumber,
          poNetValue: body.poNetValue,
          poApplyGst18: body.poApplyGst18,
          poIssueDate: body.poIssueDate,
          poExpiryDate: body.poExpiryDate,
          campTermsFiles: body.campTermsFiles,
        },
        existingRow
      );
    }
    return;
  }

  const existing = ensurePurchaseOrders(existingRow || {});
  const existingById = new Map(
    (existing.purchaseOrders || []).map((po) => [String(po.id), po])
  );
  const orders = (Array.isArray(body.purchaseOrders) ? body.purchaseOrders : [])
    .map((row, index) => normalizePurchaseOrderRow(row, index, existingById))
    .filter(
      (row) =>
        row.poNumber
        || row.poNetValue > 0
        || row.poFile?.storedName
        || (Array.isArray(row.files) && row.files.length)
        || row.poIssueDate
        || row.poExpiryDate
    )
    .map(({ _index, ...rest }) => rest);

  const combined = combinePurchaseOrders(orders);
  const first = orders[0] || null;
  const files = orders.flatMap((o) =>
    (Array.isArray(o.files) && o.files.length ? o.files : o.poFile ? [o.poFile] : [])
      .map((doc) => normalizeCampTermsFile(doc))
      .filter(Boolean)
  );
  Object.assign(payload, {
    campTerms: orders.length ? 'po_based' : existing.campTerms || 'none',
    campTermsFiles: files,
    purchaseOrders: orders,
    ...combined,
    poNumber: first?.poNumber || '',
    poNetValue: first?.poNetValue ?? 0,
    poApplyGst18: Boolean(first?.poApplyGst18),
    poGstAmount: first?.poGstAmount ?? 0,
    poGrossValue: first?.poGrossValue ?? 0,
    poIssueDate: first?.poIssueDate || '',
    poExpiryDate: first?.poExpiryDate || '',
    poFile: first?.poFile || null,
  });
}

function buildMasterPayload(body, client, existingRow = null) {
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
      } else if (field === 'spocEmail') {
        payload[field] = parseAssignedUserEmails(body[field]).join(', ');
      } else if (field === 'campTerms') {
        payload[field] = normalizeCampTermsValue(body[field]);
      } else if (field === 'billingGstin' || field === 'billingPan') {
        payload[field] = trimStr(body[field]).toUpperCase();
      } else {
        payload[field] = trimStr(body[field]);
      }
    }
  }
  applyMasterBillingFields(payload, body);
  if (body.healthcareWorker !== undefined) {
    payload.healthcareWorker = normalizeHealthcareWorkers(body.healthcareWorker);
  }
  for (const field of MASTER_NUMERIC_FIELDS) {
    if (body[field] !== undefined) {
      const n = Number(body[field]);
      payload[field] = Number.isNaN(n) ? 0 : n;
    }
  }
  applyPurchaseOrdersToPayload(payload, body, existingRow);
  if (body.mappedConsumables !== undefined) {
    payload.mappedConsumables = normalizeMappedConsumables(body.mappedConsumables);
  }
  // Ensure GSTIN key field is always normalized when present on the merged row.
  if (payload.billingGstin !== undefined) {
    payload.billingGstin = normalizeMasterBillingGstin(payload.billingGstin);
  } else if (existingRow?.billingGstin !== undefined && body.billing === undefined) {
    // keep existing via assignPreservingExisting
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
  const spocNumber = trimStr(payload.spocNumber);
  if (spocNumber) assertValidPhone(spocNumber, 'SPOC mobile number');
  const spocEmails = parseAssignedUserEmails(payload.spocEmail);
  for (const email of spocEmails) {
    assertValidEmail(email, 'SPOC email address');
  }
  const assignedEmails = parseAssignedUserEmails(payload.assignedUserEmails);
  for (const email of assignedEmails) {
    assertValidEmail(email, 'Assigned user email');
  }
  const orders = Array.isArray(payload.purchaseOrders) ? payload.purchaseOrders : [];
  for (const po of orders) {
    const net = Number(po.poNetValue);
    if (!Number.isFinite(net) || net < 0) {
      throw new AppError('PO Net Value must be zero or greater', 400, 'VALIDATION_ERROR');
    }
    if (trimStr(po.poNumber) && trimStr(po.poNumber).length > 80) {
      throw new AppError('PO Number must be 80 characters or less', 400, 'VALIDATION_ERROR');
    }
  }
  if (payload.poNetValue != null && payload.poNetValue !== '') {
    const net = Number(payload.poNetValue);
    if (!Number.isFinite(net) || net < 0) {
      throw new AppError('PO Net Value must be zero or greater', 400, 'VALIDATION_ERROR');
    }
  }
  if (trimStr(payload.poNumber) && trimStr(payload.poNumber).length > 80) {
    throw new AppError('PO Number must be 80 characters or less', 400, 'VALIDATION_ERROR');
  }
}

router.get(
  '/client-masters',
  canReadClientMaster,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.clientId) filter.clientId = String(req.query.clientId);
    const search = trimStr(req.query.search || req.query.q);
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ clientName: regex }, { programName: regex }, { campName: regex }];
    }
    const scopedFilter = await scopeEntityIdFilter(req, filter, 'clientId');
    const [data, total] = await Promise.all([
      CampOpsClientMaster.find(scopedFilter).sort('-updatedAt').skip(skip).limit(limit),
      CampOpsClientMaster.countDocuments(scopedFilter),
    ]);
    const clientIds = [...new Set(data.map((row) => String(row.clientId || '')).filter(Boolean))];
    const clients = clientIds.length
      ? await CampOpsClient.find({ isDeleted: false, _id: { $in: clientIds } })
      : [];
    const clientsById = new Map();
    for (const c of clients) {
      const key = String(c._id || '');
      clientsById.set(key, c);
      if (/^[a-f0-9]{24}$/i.test(key)) clientsById.set(key.toLowerCase(), c);
    }
    const poBalanceById = await computeClientMasterPoBalanceMap(data);
    const enriched = data.map((row) => {
      const plain = withSignedPoFile(row);
      const clientId = String(plain.clientId || '');
      const client = clientsById.get(clientId)
        || (/^[a-f0-9]{24}$/i.test(clientId) ? clientsById.get(clientId.toLowerCase()) : null);
      const poSummary = poBalanceById.get(String(plain._id || '')) || null;
      return {
        ...plain,
        clientCode: client?.code || '',
        billing: masterBillingView(plain, client),
        poTotalValue: poSummary?.poTotalValue ?? 0,
        poBilledAmount: poSummary?.poBilledAmount ?? 0,
        poBalance: poSummary?.poBalance ?? null,
      };
    });
    res.json(paginated(enriched, total, page, limit));
  })
);

router.get(
  '/client-masters/export',
  canRead,
  asyncHandler(async (req, res) => {
    const scopedFilter = await scopeEntityIdFilter(req, { isDeleted: false }, 'clientId');
    const rows = await CampOpsClientMaster.find(scopedFilter).sort('-updatedAt');
    const clientIds = [...new Set(rows.map((r) => String(r.clientId || '')).filter(Boolean))];
    const clients = clientIds.length
      ? await CampOpsClient.find({ _id: { $in: clientIds }, isDeleted: false })
      : [];
    const clientsById = new Map();
    for (const c of clients) {
      const key = String(c._id || '');
      clientsById.set(key, c);
      if (/^[a-f0-9]{24}$/i.test(key)) clientsById.set(key.toLowerCase(), c);
    }
    sendExcel(
      res,
      'Client_Master.xlsx',
      CLIENT_MASTER_HEADERS,
      rows.map((r) => {
        const clientId = String(r.clientId || '');
        const client = clientsById.get(clientId)
          || (/^[a-f0-9]{24}$/i.test(clientId) ? clientsById.get(clientId.toLowerCase()) : null);
        return clientMasterToExcelRow(r, masterBillingView(r, client), client);
      }),
      { sheetName: 'Client Master' }
    );
  })
);

router.get(
  '/client-masters/sample',
  canRead,
  asyncHandler(async (_req, res) => {
    sendCsv(
      res,
      sampleCsvFilename('Client_Master'),
      CLIENT_MASTER_HEADERS,
      [CLIENT_MASTER_SAMPLE_ROW]
    );
  })
);

router.post(
  '/client-masters/import',
  canRequest,
  importRateLimiter,
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    const a = actor(req);
    const { job, summary } = await executeUploadedImport({
      file: req.file,
      userId: req.user?._id,
      importType: 'CampOpsClientMaster',
      processRow: async ({ record: row }) => {
        const parsed = await parseClientMasterImportRow(row);
        if (!parsed) return { skipped: true };
        const client = await resolveClientFromBody(
          {
            clientName: parsed.clientName,
            clientCode: parsed.clientCode || undefined,
          },
          { allowCreate: true, syncBilling: false }
        );
        if (!client) throw new AppError('Client is required', 400, 'VALIDATION_ERROR');
        const importGstin = normalizeMasterBillingGstin(
          parsed.billing?.gstin || parsed.billingGstin || ''
        );
        let existing = await CampOpsClientMaster.findOne(
          buildClientMasterBusinessKeyFilter({
            clientId: client._id,
            billingGstin: importGstin,
            programName: parsed.programName,
            campName: parsed.campName,
          })
        );
        // Legacy rows: billing lived on the company; row GSTIN may still be empty.
        if (!existing && importGstin) {
          existing = await CampOpsClientMaster.findOne(
            buildLegacyEmptyGstinMatchFilter({
              clientId: client._id,
              programName: parsed.programName,
              campName: parsed.campName,
            })
          );
        }
        const payload = buildMasterPayload(parsed, client, existing);
        if (payload.billingGstin === undefined) {
          payload.billingGstin = importGstin;
        }
        assertClientMasterPayload({
          ...(existing?.toObject ? existing.toObject() : existing || {}),
          ...payload,
        });
        const clearKeys =
          payload.campTerms === 'none'
            ? [
                'poNumber',
                'poIssueDate',
                'poExpiryDate',
                'agreementStartDate',
                'agreementEffectiveDate',
                'agreementEndDate',
                'poFile',
              ]
            : [];
        if (existing) {
          assignPreservingExisting(existing, payload, { clearKeys });
          existing.updatedById = a.id;
          await existing.save();
          return { updated: true };
        }
        await assertClientMasterBusinessKeyUnique({
          clientId: client._id,
          billingGstin: payload.billingGstin,
          programName: payload.programName,
          campName: payload.campName,
        });
        await CampOpsClientMaster.create({
          ...payload,
          createdById: a.id,
          updatedById: a.id,
        });
        return { ok: true };
      },
    });

    res.json({
      data: {
        jobId: job?._id,
        status: job?.status,
        percent: job?.percent ?? 100,
        totalRows: summary.totalRows,
        created: summary.created,
        updated: summary.updated,
        errorRows: summary.errorRows,
        errors: summary.errors,
      },
    });
  })
);

function idsEqualClient(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  if (left === right) return true;
  if (/^[a-f0-9]{24}$/i.test(left) && /^[a-f0-9]{24}$/i.test(right)) {
    return left.toLowerCase() === right.toLowerCase();
  }
  return false;
}

router.get(
  '/client-masters/by-client/:clientId',
  canReadClientMaster,
  asyncHandler(async (req, res) => {
    const clientId = String(req.params.clientId || '').trim();
    if (clientId && clientId !== 'undefined' && clientId !== '[object Object]') {
      await assertClientIdAccess(req.user, clientId);
    }
    const clientName = trimStr(req.query.clientName);
    let rows = clientId && clientId !== 'undefined' && clientId !== '[object Object]'
      ? await CampOpsClientMaster.find({
        isDeleted: false,
        clientId,
      }).sort('programName')
      : [];

    // Fallback when camp/client id casing or legacy linkage differs from Client Master.
    if (!rows.length && clientName) {
      const all = await CampOpsClientMaster.find({ isDeleted: false }).sort('programName');
      const needle = clientName.toLowerCase();
      rows = all.filter((row) => trimStr(row.clientName).toLowerCase() === needle);
    }
    // Name fallback must not widen past assigned-client scope.
    const scoped = await resolveCampClientScope(req.user);
    if (scoped) {
      rows = rows.filter((row) => isClientIdInScope(scoped, row.clientId));
    }

    res.json({
      data: rows.map((row) => (row.toObject ? row.toObject() : row)),
    });
  })
);

router.get(
  '/client-masters/by-client/:clientId/divisions',
  canReadClientMaster,
  asyncHandler(async (req, res) => {
    const clientId = String(req.params.clientId || '').trim();
    const clientName = trimStr(req.query.clientName);
    let client = clientId && clientId !== 'undefined' && clientId !== '[object Object]'
      ? await CampOpsClient.findOne({ _id: clientId, isDeleted: false })
      : null;
    if (!client && clientName) {
      client = await CampOpsClient.findOne({
        isDeleted: false,
        name: new RegExp(`^${escapeRegex(clientName)}$`, 'i'),
      });
    }
    if (!client) throw new AppError('Client not found', 404, 'NOT_FOUND');
    await assertClientIdAccess(req.user, client._id);

    const records = await CampOpsClientMaster.find({
      isDeleted: false,
      clientId: client._id,
    }).sort('programName');

    // Include case-variant / name-linked masters if id match alone is empty.
    let rows = records;
    if (!rows.length) {
      const all = await CampOpsClientMaster.find({ isDeleted: false }).sort('programName');
      const needle = trimStr(client.name).toLowerCase();
      rows = all.filter((row) => (
        idsEqualClient(row.clientId, client._id)
        || trimStr(row.clientName).toLowerCase() === needle
      ));
    }

    const divisionMap = new Map();
    for (const record of rows) {
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
  canReadClientMaster,
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    await assertClientIdAccess(req.user, row.clientId);
    const client = row.clientId
      ? await CampOpsClient.findOne({ _id: row.clientId, isDeleted: false })
      : null;
    if (client && seedMasterBillingFromCompany(row, client)) {
      await row.save();
    }
    const plain = withSignedPoFile(row);
    res.json({
      data: {
        ...plain,
        clientCode: client?.code || '',
        billing: masterBillingView(plain, client),
        client: client
          ? {
              _id: client._id,
              name: client.name,
              code: client.code,
              ...clientBillingView(client),
            }
          : null,
      },
    });
  })
);

router.post(
  '/client-masters',
  canRequest,
  asyncHandler(async (req, res) => {
    // Never sync form billing onto the shared company — billing is per Client Master row.
    const client = await resolveClientFromBody(req.body, { allowCreate: true, syncBilling: false });
    if (!client) throw new AppError('Client is required', 400, 'VALIDATION_ERROR');
    const payload = buildMasterPayload(req.body, client);
    if (payload.billingGstin === undefined) payload.billingGstin = '';
    assertClientMasterPayload(payload);
    if (!payload.campName) payload.campName = 'BMD';
    await assertClientMasterBusinessKeyUnique({
      clientId: client._id,
      billingGstin: payload.billingGstin,
      programName: payload.programName,
      campName: payload.campName,
    });
    const a = actor(req);
    const row = await CampOpsClientMaster.create({
      ...payload,
      createdById: a.id,
      updatedById: a.id,
    });
    await audit(req, 'camp_ops.client_master_create', 'camp_ops_client_master', row._id, null, row.toObject());
    const plain = withSignedPoFile(row);
    res.status(201).json({
      data: {
        ...plain,
        billing: masterBillingView(plain, client),
      },
    });
  })
);

router.put(
  '/client-masters/:id',
  canRequest,
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    try {
      assertNotStale(row, req.body.expectedUpdatedAt || req.body.updatedAt, {
        label: 'Client Master',
      });
    } catch (err) {
      if (err?.code === 'STALE_UPDATE') {
        throw new AppError(err.message, 409, 'STALE_UPDATE');
      }
      throw err;
    }
    const before = row.toObject();
    let client = null;
    if (req.body.clientId || req.body.clientName) {
      client = await resolveClientFromBody(req.body, { allowCreate: false, syncBilling: false });
      if (!client) throw new AppError('Client not found', 404, 'NOT_FOUND');
    } else {
      client = await CampOpsClient.findOne({ _id: row.clientId, isDeleted: false });
      if (!client) {
        client = { _id: row.clientId, name: row.clientName };
      }
    }
    const payload = buildMasterPayload(req.body, client, row);
    const clearKeys =
      payload.campTerms === 'none' && req.body.campTerms !== undefined
        ? [
            'poNumber',
            'poIssueDate',
            'poExpiryDate',
            'agreementStartDate',
            'agreementEffectiveDate',
            'agreementEndDate',
            'poFile',
          ]
        : [];
    assignPreservingExisting(row, payload, { clearKeys });
    if (client) seedMasterBillingFromCompany(row, client);
    row.billingGstin = normalizeMasterBillingGstin(row.billingGstin);
    assertClientMasterPayload(row);
    await assertClientMasterBusinessKeyUnique({
      clientId: row.clientId,
      billingGstin: row.billingGstin,
      programName: row.programName,
      campName: row.campName,
      excludeId: row._id,
    });
    row.updatedById = actor(req).id;
    await row.save();
    await audit(req, 'camp_ops.client_master_update', 'camp_ops_client_master', row._id, before, row.toObject());
    const plain = withSignedPoFile(row);
    res.json({
      data: {
        ...plain,
        billing: masterBillingView(plain, client),
      },
    });
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

const clientMasterPoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, campUploadRoot),
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || 'po-file').replace(/[^\w.\-]+/g, '_');
      cb(null, `po-${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const name = String(file.originalname || '').toLowerCase();
    const allowed =
      mime === 'application/pdf'
      || mime.startsWith('image/')
      || mime.includes('word')
      || mime.includes('sheet')
      || mime.includes('excel')
      || /\.(pdf|png|jpe?g|webp|docx?|xlsx?)$/i.test(name);
    cb(allowed ? null : new Error('PO file type not allowed'), allowed);
  },
});

function unlinkPoFile(storedName) {
  if (!storedName) return;
  const full = path.join(campUploadRoot, storedName);
  try {
    if (fs.existsSync(full)) fs.unlinkSync(full);
  } catch {
    /* ignore */
  }
}

function getCampTermsFilesMutable(row) {
  const ensured = ensurePurchaseOrders(row);
  if (!Array.isArray(row.campTermsFiles)) {
    row.campTermsFiles = ensured.campTermsFiles.map((file) => ({ ...file }));
  }
  return row.campTermsFiles;
}

function syncCampTermsFileMirror(row) {
  const files = Array.isArray(row.campTermsFiles) ? row.campTermsFiles : [];
  row.poFile = files[0] || null;
  if (Array.isArray(row.purchaseOrders) && row.purchaseOrders[0]) {
    row.purchaseOrders[0] = { ...row.purchaseOrders[0], poFile: files[0] || null };
  }
}

router.post(
  '/client-masters/:id/camp-terms-files',
  canRequest,
  clientMasterPoUpload.array('files', 10),
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    const uploaded = Array.isArray(req.files) ? req.files : [];
    if (!uploaded.length) throw new AppError('At least one file is required', 400, 'VALIDATION_ERROR');

    const files = getCampTermsFilesMutable(row);
    for (const file of uploaded) {
      files.push({
        id: newCampTermsFileId(),
        fileName: file.originalname || file.filename,
        storedName: file.filename,
        mimeType: file.mimetype || 'application/octet-stream',
        fileSize: file.size || 0,
        url: `/uploads/camp-ops/${file.filename}`,
        uploadedAt: new Date().toISOString(),
      });
    }
    if (!row.campTerms || row.campTerms === 'none') {
      row.campTerms = 'approval_based';
    }
    syncCampTermsFileMirror(row);
    row.updatedById = actor(req).id;
    await row.save();
    await audit(req, 'camp_ops.client_master_camp_terms_files', 'camp_ops_client_master', row._id, null, {
      count: uploaded.length,
    });
    res.json({ data: withSignedPoFile(row) });
  })
);

router.get(
  '/client-masters/:id/camp-terms-files/:fileId',
  canReadClientMaster,
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    const files = collectCampTermsFiles(row);
    const doc =
      files.find((f) => String(f.id) === String(req.params.fileId) || String(f.storedName) === String(req.params.fileId));
    if (!doc?.storedName) throw new AppError('File not found', 404, 'NOT_FOUND');
    const full = path.join(campUploadRoot, doc.storedName);
    if (!fs.existsSync(full)) throw new AppError('File missing on server', 404, 'NOT_FOUND');
    res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${String(doc.fileName || doc.storedName).replace(/"/g, '')}"`
    );
    fs.createReadStream(full).pipe(res);
  })
);

router.delete(
  '/client-masters/:id/camp-terms-files/:fileId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    const files = getCampTermsFilesMutable(row);
    const idx = files.findIndex(
      (f) => String(f.id) === String(req.params.fileId) || String(f.storedName) === String(req.params.fileId)
    );
    if (idx < 0) throw new AppError('File not found', 404, 'NOT_FOUND');
    const [removed] = files.splice(idx, 1);
    syncCampTermsFileMirror(row);
    row.updatedById = actor(req).id;
    await row.save();
    unlinkPoFile(removed?.storedName);
    await audit(req, 'camp_ops.client_master_camp_terms_file_delete', 'camp_ops_client_master', row._id, null, {
      fileId: req.params.fileId,
    });
    res.json({ data: withSignedPoFile(row) });
  })
);

function getPurchaseOrdersMutable(row) {
  const ensured = ensurePurchaseOrders(row);
  if (!Array.isArray(row.purchaseOrders) || !row.purchaseOrders.length) {
    row.purchaseOrders = ensured.purchaseOrders.map((po) => ({ ...po }));
  }
  return row.purchaseOrders;
}

function syncLegacyPoMirror(row) {
  const orders = Array.isArray(row.purchaseOrders) ? row.purchaseOrders : [];
  const combined = combinePurchaseOrders(orders);
  const first = orders[0] || null;
  row.poCombinedNet = combined.poCombinedNet;
  row.poCombinedGst = combined.poCombinedGst;
  row.poCombinedGross = combined.poCombinedGross;
  row.poNumber = first?.poNumber || '';
  row.poNetValue = first?.poNetValue ?? 0;
  row.poApplyGst18 = Boolean(first?.poApplyGst18);
  row.poGstAmount = first?.poGstAmount ?? 0;
  row.poGrossValue = first?.poGrossValue ?? 0;
  row.poIssueDate = first?.poIssueDate || '';
  row.poExpiryDate = first?.poExpiryDate || '';
  row.poFile = first?.poFile || first?.files?.[0] || null;
  row.campTerms = orders.length ? 'po_based' : row.campTerms || 'none';
  row.campTermsFiles = orders.flatMap((o) =>
    (Array.isArray(o.files) && o.files.length ? o.files : o.poFile ? [o.poFile] : [])
      .map((doc) => normalizeCampTermsFile(doc))
      .filter(Boolean)
  );
}

function ensurePoFilesArray(entry) {
  if (!entry) return [];
  if (!Array.isArray(entry.files)) {
    entry.files = entry.poFile?.storedName
      ? [normalizeCampTermsFile(entry.poFile, `${entry.id}-f-1`)].filter(Boolean)
      : [];
  }
  return entry.files;
}

function appendFilesToPoEntry(entry, uploaded = []) {
  const files = ensurePoFilesArray(entry);
  for (const file of uploaded) {
    files.push({
      id: newCampTermsFileId(),
      fileName: file.originalname || file.filename,
      storedName: file.filename,
      mimeType: file.mimetype || 'application/octet-stream',
      fileSize: file.size || 0,
      url: `/uploads/camp-ops/${file.filename}`,
      uploadedAt: new Date().toISOString(),
    });
  }
  entry.files = files;
  entry.poFile = files[0] || null;
  return files;
}

function findPoFileOnEntry(entry, fileId) {
  const files = ensurePoFilesArray(entry);
  return files.find(
    (f) => String(f.id) === String(fileId) || String(f.storedName) === String(fileId)
  );
}

function findPoEntry(row, poId) {
  const orders = getPurchaseOrdersMutable(row);
  if (poId) {
    const hit = orders.find((po) => String(po.id) === String(poId));
    if (hit) {
      ensurePoFilesArray(hit);
      return { orders, entry: hit };
    }
    const entry = {
      id: String(poId),
      poNumber: '',
      poNetValue: 0,
      poApplyGst18: false,
      poGstAmount: 0,
      poGrossValue: 0,
      poIssueDate: '',
      poExpiryDate: '',
      files: [],
      poFile: null,
    };
    orders.push(entry);
    return { orders, entry };
  }
  if (!orders.length) {
    const entry = {
      id: newPoId(),
      poNumber: '',
      poNetValue: 0,
      poApplyGst18: false,
      poGstAmount: 0,
      poGrossValue: 0,
      poIssueDate: '',
      poExpiryDate: '',
      files: [],
      poFile: null,
    };
    orders.push(entry);
    return { orders, entry };
  }
  ensurePoFilesArray(orders[0]);
  return { orders, entry: orders[0] };
}

function sendPoFileResponse(res, doc) {
  if (!doc?.storedName) throw new AppError('No PO file attached', 404, 'NOT_FOUND');
  const full = path.join(campUploadRoot, doc.storedName);
  if (!fs.existsSync(full)) throw new AppError('PO file missing on server', 404, 'NOT_FOUND');
  res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${String(doc.fileName || doc.storedName).replace(/"/g, '')}"`
  );
  fs.createReadStream(full).pipe(res);
}

router.get(
  '/client-masters/:id/po-file/:poId',
  canReadClientMaster,
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    const { entry } = findPoEntry(row, req.params.poId);
    const files = ensurePoFilesArray(entry);
    sendPoFileResponse(res, files[0] || entry?.poFile);
  })
);

router.get(
  '/client-masters/:id/po-file/:poId/:fileId',
  canReadClientMaster,
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    const { entry } = findPoEntry(row, req.params.poId);
    const doc = findPoFileOnEntry(entry, req.params.fileId);
    sendPoFileResponse(res, doc);
  })
);

router.get(
  '/client-masters/:id/po-file',
  canReadClientMaster,
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    const ensured = ensurePurchaseOrders(row);
    const doc = ensured.purchaseOrders[0]?.poFile || row.poFile;
    sendPoFileResponse(res, doc);
  })
);

router.post(
  '/client-masters/:id/po-file/:poId',
  canRequest,
  clientMasterPoUpload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'poFile', maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    const uploaded = [
      ...(Array.isArray(req.files?.files) ? req.files.files : []),
      ...(Array.isArray(req.files?.poFile) ? req.files.poFile : []),
    ];
    if (!uploaded.length) throw new AppError('PO file is required', 400, 'VALIDATION_ERROR');

    const { entry } = findPoEntry(row, req.params.poId);
    appendFilesToPoEntry(entry, uploaded);
    syncLegacyPoMirror(row);
    row.updatedById = actor(req).id;
    await row.save();
    await audit(req, 'camp_ops.client_master_po_file', 'camp_ops_client_master', row._id, null, {
      count: uploaded.length,
      poId: entry.id,
    });
    res.json({ data: withSignedPoFile(row) });
  })
);

router.post(
  '/client-masters/:id/po-file',
  canRequest,
  clientMasterPoUpload.fields([
    { name: 'files', maxCount: 10 },
    { name: 'poFile', maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    const uploaded = [
      ...(Array.isArray(req.files?.files) ? req.files.files : []),
      ...(Array.isArray(req.files?.poFile) ? req.files.poFile : []),
    ];
    if (!uploaded.length) throw new AppError('PO file is required', 400, 'VALIDATION_ERROR');

    const { entry } = findPoEntry(row, null);
    appendFilesToPoEntry(entry, uploaded);
    syncLegacyPoMirror(row);
    row.updatedById = actor(req).id;
    await row.save();
    await audit(req, 'camp_ops.client_master_po_file', 'camp_ops_client_master', row._id, null, {
      count: uploaded.length,
      poId: entry.id,
    });
    res.json({ data: withSignedPoFile(row) });
  })
);

router.delete(
  '/client-masters/:id/po-file/:poId/:fileId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    const { entry } = findPoEntry(row, req.params.poId);
    const files = ensurePoFilesArray(entry);
    const idx = files.findIndex(
      (f) =>
        String(f.id) === String(req.params.fileId)
        || String(f.storedName) === String(req.params.fileId)
    );
    if (idx < 0) throw new AppError('File not found', 404, 'NOT_FOUND');
    const [removed] = files.splice(idx, 1);
    entry.files = files;
    entry.poFile = files[0] || null;
    syncLegacyPoMirror(row);
    row.updatedById = actor(req).id;
    await row.save();
    unlinkPoFile(removed?.storedName);
    await audit(req, 'camp_ops.client_master_po_file_delete', 'camp_ops_client_master', row._id, null, {
      ok: true,
      poId: req.params.poId,
      fileId: req.params.fileId,
    });
    res.json({ data: withSignedPoFile(row) });
  })
);

router.delete(
  '/client-masters/:id/po-file/:poId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    const { entry } = findPoEntry(row, req.params.poId);
    const files = ensurePoFilesArray(entry);
    const removedNames = files.map((f) => f.storedName).filter(Boolean);
    if (entry) {
      entry.files = [];
      entry.poFile = null;
    }
    syncLegacyPoMirror(row);
    row.updatedById = actor(req).id;
    await row.save();
    removedNames.forEach(unlinkPoFile);
    await audit(req, 'camp_ops.client_master_po_file_delete', 'camp_ops_client_master', row._id, null, {
      ok: true,
      poId: req.params.poId,
    });
    res.json({ data: withSignedPoFile(row) });
  })
);

router.delete(
  '/client-masters/:id/po-file',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await CampOpsClientMaster.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
    const { entry } = findPoEntry(row, null);
    const files = ensurePoFilesArray(entry);
    const removedNames = [
      ...files.map((f) => f.storedName),
      entry?.poFile?.storedName,
      row.poFile?.storedName,
    ].filter(Boolean);
    if (entry) {
      entry.files = [];
      entry.poFile = null;
    }
    row.poFile = null;
    syncLegacyPoMirror(row);
    row.updatedById = actor(req).id;
    await row.save();
    [...new Set(removedNames)].forEach(unlinkPoFile);
    await audit(req, 'camp_ops.client_master_po_file_delete', 'camp_ops_client_master', row._id, null, {
      ok: true,
    });
    res.json({ data: withSignedPoFile(row) });
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
    // Keep sample cells aligned 1:1 with CAMP_IMPORT_FIELDS / Create Camp form labels.
    const rows = [
      [
        'Import',
        'Acme Pharma',
        'Screening',
        'BMD',
        '01/08/2026',
        '30/07/2026',
        '09:00',
        '12:00',
        'Dr Example',
        'D001',
        'General Practitioner',
        '12 Main Street',
        '400001',
        'Mumbai',
        '40',
        'Territory Manager',
        'Rep One',
        '9999999999',
      ],
      [
        'Email',
        'Acme Pharma',
        'Oncology',
        'Neuro & Physio',
        '15/08/2026',
        '10/08/2026',
        '10:00',
        '14:00',
        'Dr Sharma',
        'D002',
        'Orthopedics',
        '45 Park Avenue',
        '411001',
        'Pune',
        '25',
        'Area Manager',
        'Rep Two',
        '9888888888',
      ],
    ];
    sendCsv(res, 'camp-import-sample.csv', headers, rows);
  })
);

router.post(
  '/import/parse',
  canRequest,
  importRateLimiter,
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (req.file) {
      assertSpreadsheetUpload(req.file);
      const parsed = await parsePasteImportFile(req.file);
      const fileName = req.file.originalname || 'upload';
      res.json({
        fileName,
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
      throw importAppError('ROWS_MAPPING_REQUIRED');
    }
    const mappedRows = mapImportRows(rows, mapping, defaultClientName);
    const enrichedRows = await enrichMappedImportRowsFromPin(mappedRows);
    const { validRows, invalidRows } = validateMappedImportRows(enrichedRows);
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
      throw importAppError('ROWS_MAPPING_REQUIRED');
    }
    const mappedRows = mapImportRows(rows, mapping, defaultClientName);
    const enrichedRows = await enrichMappedImportRowsFromPin(mappedRows);
    const { validRows, invalidRows } = validateMappedImportRows(enrichedRows);
    if (!validRows.length) {
      throw importAppError('NO_VALID_ROWS', 400, 'VALIDATION_ERROR', { invalidRows });
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
      assertHistoricalCampDatesAllowed(req.user, req.permissions, {
        campDate: row.campDate,
        requestDate: row.requestDate,
      });
      await assertClientIdAccess(req.user, client._id);
      const tracking = captureSubmissionTracking();
      const contactFields = resolveContactPersonFields(row);
      const camp = await CampOpsCamp.create(formatCampTextPayload({
        campId: await generateCampId(row.campDate),
        clientId: client._id,
        clientName: client.name,
        campaignName: normalizeCampName(row.campaignName),
        campaignType: row.campaignType || 'Screening',
        doctorName: row.doctorName,
        doctorCode: row.doctorCode,
        speciality: row.speciality || '',
        hospitalName: row.hospitalName || '',
        campAddress: row.campAddress,
        city: row.city,
        district: row.district || row.city || '',
        state: row.state,
        pincode: row.pincode,
        hq: row.hq || row.city || '',
        zone: row.zone || '',
        campDate: row.campDate,
        requestDate: row.requestDate || new Date().toISOString().slice(0, 10),
        lifecycleStage: 'request',
        ...schedule,
        expectedPatients: row.expectedPatients || 0,
        ...contactFields,
        fieldPersonName: row.fieldPersonName,
        fieldPersonPhone: row.fieldPersonPhone,
        remarks: row.remarks || '',
        source: normalizeImportSource(row.source, 'excel'),
        status: 'pending_review',
        createdById: a.id,
        createdByEmail: a.email,
        ...tracking,
      }));
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

function preserveMultilineText(value) {
  // Do not use trimStr/cleanSpaces — those collapse newlines and break paste label parsing.
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

router.post(
  '/communications/paste/extract',
  canRequest,
  asyncHandler(async (req, res) => {
    const text = preserveMultilineText(req.body?.text);
    if (!text) throw new AppError('Paste text is required', 400, 'VALIDATION_ERROR');
    const defaults = {
      clientName: trimStr(req.body?.clientName),
      campaignType: trimStr(req.body?.campaignType),
      campaignName: trimStr(req.body?.campaignName),
    };
    const data = await extractManualPastePreview({
      text,
      defaults,
      user: req.user,
      referenceDate: trimStr(req.body?.referenceDate) || null,
      timezone: trimStr(req.body?.timezone) || 'Asia/Kolkata',
    });
    res.json({ data });
  })
);

/**
 * Preview-only hybrid event extractor (deterministic → OpenAI fallback).
 * Never writes camps — feed results into /communications/paste/process after review.
 */
router.post(
  '/communications/event-extractor/extract',
  canRequest,
  asyncHandler(async (req, res) => {
    const text = preserveMultilineText(req.body?.text);
    if (!text) throw new AppError('Paste text is required', 400, 'VALIDATION_ERROR');
    const defaults = {
      clientName: trimStr(req.body?.clientName) || 'Unassigned Client',
      campaignType: trimStr(req.body?.campaignType) || 'Screening',
      campaignName: trimStr(req.body?.campaignName) || 'BMD',
    };
    // Allow standalone extractor calls without full paste context by using safe defaults
    // when omitted — still never persists without /paste/process.
    const data = await extractManualPastePreview({
      text,
      defaults: {
        clientName: trimStr(req.body?.clientName) || defaults.clientName,
        campaignType: trimStr(req.body?.campaignType) || defaults.campaignType,
        campaignName: trimStr(req.body?.campaignName) || defaults.campaignName,
      },
      user: req.user,
      referenceDate: trimStr(req.body?.referenceDate) || null,
      timezone: trimStr(req.body?.timezone) || 'Asia/Kolkata',
    });
    res.json({
      data: {
        status: data.bodyPreview?.some((r) => r.extraction?.status === 'CONFLICT')
          ? 'CONFLICT'
          : data.bodyPreview?.every((r) => r.valid)
            ? 'READY'
            : 'REVIEW_REQUIRED',
        events: data.bodyPreview || [],
        warnings: (data.bodyPreview || []).flatMap((r) => r.extraction?.warnings || r.errors || []),
        conflicts: (data.bodyPreview || []).flatMap((r) => r.extraction?.conflicts || []),
        confidence: data.bodyPreview?.[0]?.extraction?.confidence ?? null,
        summary: data.summary,
        referenceDate: data.referenceDate,
        timezone: data.timezone,
        extractedAt: data.extractedAt,
      },
    });
  })
);

router.post(
  '/communications/paste/parse-file',
  canRequest,
  importRateLimiter,
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    assertSpreadsheetUpload(req.file);
    const parsed = await parsePasteImportFile(req.file, {
      fieldKeys: CAMP_PASTE_TABULAR_FIELD_KEYS,
    });
    const fileName = req.file.originalname || 'upload';
    res.json({
      data: {
        ...parsed,
        fileName,
      },
    });
  })
);

router.post(
  '/communications/paste/extract-file',
  canRequest,
  importRateLimiter,
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    assertSpreadsheetUpload(req.file);
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
      file: req.file,
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
        text: preserveMultilineText(req.body?.text),
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
    const pinMaster = req.body?.pinMaster || req.body?.pin_master || null;
    const row = parsedFieldsToCampRow(parsedFields, defaults, pinMaster);
    // Infer address from city/state when parser only captured pin + locality.
    if (!row.campAddress && (row.city || row.state || row.pincode)) {
      row.campAddress = [row.city, row.district, row.state, row.pincode].filter(Boolean).join(', ');
    }
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
    assertHistoricalCampDatesAllowed(req.user, req.permissions, {
      campDate: payload.campDate,
      requestDate: payload.requestDate,
    });
    await assertClientIdAccess(req.user, client?._id || payload.clientId);
    const tracking = captureSubmissionTracking();
    const camp = await CampOpsCamp.create({
      ...payload,
      campId: await generateCampId(payload.campDate),
      status: 'pending_review',
      lifecycleStage: 'request',
      source: 'parser',
      createdById: actor(req).id,
      createdByEmail: actor(req).email,
      ...tracking,
    });
    await audit(req, 'camp_ops.create', 'camp_ops_camp', camp._id, null, camp.toObject());
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
        text: preserveMultilineText(req.body?.text),
        defaults,
      },
      actor(req),
      { resolveClientFromBody, campPayloadFromBody, user: req.user, permissions: req.permissions },
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
    if (req.query.activeOnly === '1' || req.query.activeOnly === 'true') {
      filter.isActive = { $ne: false };
    }
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
