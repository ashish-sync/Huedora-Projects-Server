import { AppError } from '../../utils/helpers.js';
import { env } from '../../config/env.js';
import { getDoctorNameFormatError } from '../../utils/textFormat.js';
import { GeoCity, GeoDistrict, GeoPinCode, GeoState } from '../geo/geo.model.js';
import { enrichPinRecords } from '../geo/pinCode.service.js';
import { CampOpsCamp, CampOpsClient, CampOpsClientMaster } from './campOps.model.js';
import { CAMP_OPS_SOURCES, normalizeCampName } from './campOps.constants.js';
import {
  trimStr,
  formatCampTextPayload,
  resolveCampSchedule,
  parseLocalDateInput,
  generateCampId,
  captureSubmissionTracking,
} from './campOps.helpers.js';
import { CONTACT_LEVEL_IMPORT_FIELDS, resolveContactPersonFields } from './campContactPersons.js';
import { parsePasteImportFile } from './pasteImport.service.js';
import { mapRows } from './communications/utils/importMapper.js';
import { normalizePasteStartTime } from './pasteTimeNormalize.js';
import { importAppError } from '../../utils/importErrors.js';
import { MAX_IMPORT_ROWS } from '../../utils/spreadsheetLimits.js';
import { lifecyclePayloadFromBody } from './campOps.lifecycle.js';
import {
  parseCampDurationToHours,
  resolveClientMasterPricingForCamp,
} from './campOps.clientMasterPricing.js';
import { assertRequestStageComplete } from './campOps.requestValidation.js';
import { assertHistoricalCampDatesAllowed } from './campDatePolicy.js';
import {
  createCampEnsuringNoDuplicate,
  CampDuplicateError,
} from './campDuplicate.js';
import { hashExecutionToken, mintExecutionToken } from './campExecute.service.js';

export const PROGRAM_REQUEST_FORM_SOURCE = 'program_form';
export const PROGRAM_REQUEST_NOT_FOUND_MESSAGE = 'This camp request form is not available';

/** Public form columns — Client / Division / Method stay locked from the program token. */
export const PROGRAM_FORM_SAMPLE_FIELDS = [
  { key: 'doctorName', label: 'Doctor Name', required: true },
  { key: 'doctorCode', label: 'Doctor Code', required: true },
  { key: 'speciality', label: 'Doctor Type / Specialty', required: false },
  { key: 'campDate', label: 'Camp Date', required: true },
  { key: 'startTime', label: 'Camp Start Time', required: true },
  { key: 'endTime', label: 'Camp End Time', required: true },
  { key: 'campAddress', label: 'Camp / Clinic Address', required: true },
  { key: 'contactPersonLevel', label: 'Contact Person Level', required: true },
  { key: 'fieldPersonName', label: 'Contact Person Name', required: true },
  { key: 'fieldPersonPhone', label: 'Contact Person Number', required: true },
  { key: 'hq', label: 'HQ (Headquarter)', required: true },
  { key: 'expectedPatients', label: 'Expected Patients', required: true },
  { key: 'remarks', label: 'Remarks', required: false },
];

export const PROGRAM_FORM_SAMPLE_ROW = [
  'Anita Sharma',
  'D001',
  'General Practitioner',
  '15-11-2026',
  '09:00',
  '13:00',
  '12 Main Street',
  'Territory Manager',
  'Rep One',
  '9999999999',
  'Mumbai',
  '40',
  '',
];

export const PROGRAM_FORM_IMPORT_KEYS = [
  ...new Set([
    ...PROGRAM_FORM_SAMPLE_FIELDS.map((field) => field.key),
    ...CONTACT_LEVEL_IMPORT_FIELDS.flatMap((field) => [field.nameKey, field.phoneKey]),
  ]),
];

function publicGeoRow(row) {
  if (!row) return null;
  const o = row.toObject ? row.toObject() : { ...row };
  return {
    _id: o._id,
    name: o.name || '',
    stateId: o.stateId || '',
    districtId: o.districtId || '',
  };
}

export function sanitizeProgramRequestBody(body, { client, master } = {}) {
  const src = body && typeof body === 'object' ? body : {};
  return {
    requestDate: src.requestDate,
    campDate: src.campDate,
    startTime: src.startTime,
    endTime: src.endTime,
    durationHours: src.durationHours,
    doctorName: src.doctorName,
    doctorCode: src.doctorCode,
    speciality: src.speciality,
    campAddress: src.campAddress,
    googlePlaceId: src.googlePlaceId,
    addressManualEntry: src.addressManualEntry === true,
    city: src.city,
    cityId: src.cityId,
    state: src.state,
    stateId: src.stateId,
    district: src.district,
    districtId: src.districtId,
    pincode: src.pincode,
    zone: src.zone,
    hq: src.hq,
    latitude: src.latitude,
    longitude: src.longitude,
    expectedPatients: src.expectedPatients,
    contactPersons: src.contactPersons,
    contactPersonLevel: src.contactPersonLevel,
    fieldPersonName: src.fieldPersonName,
    fieldPersonPhone: src.fieldPersonPhone,
    remarks: src.remarks,
    clientId: client?._id ?? null,
    clientName: client?.name || '',
    campaignType: trimStr(master?.programName),
    campaignName: normalizeCampName(master?.campName || 'BMD'),
    source: PROGRAM_REQUEST_FORM_SOURCE,
    lifecycleStage: 'request',
  };
}

export function publicProgramRequestContext(master, client) {
  return {
    clientId: client?._id || master?.clientId || '',
    clientName: client?.name || master?.clientName || '',
    clientCode: client?.code || '',
    programName: trimStr(master?.programName),
    campName: normalizeCampName(master?.campName || 'BMD'),
    campDuration: trimStr(master?.campDuration),
    campType: trimStr(master?.campType),
  };
}

export function programRequestFormUrl(token) {
  const path = `/c/${token}`;
  const origin = String(env.clientOrigin || '').replace(/\/$/, '');
  return {
    path,
    url: origin ? `${origin}${path}` : path,
  };
}

export async function resolveProgramByRequestToken(rawToken) {
  const hash = hashExecutionToken(rawToken);
  if (!hash) {
    throw new AppError(PROGRAM_REQUEST_NOT_FOUND_MESSAGE, 404, 'NOT_FOUND');
  }
  const master = await CampOpsClientMaster.findOne({
    requestFormTokenHash: hash,
    isDeleted: false,
  });
  if (!master || master.isActive === false) {
    throw new AppError(PROGRAM_REQUEST_NOT_FOUND_MESSAGE, 404, 'NOT_FOUND');
  }
  const client = master.clientId
    ? await CampOpsClient.findOne({ _id: master.clientId, isDeleted: false })
    : null;
  if (!client) {
    throw new AppError(PROGRAM_REQUEST_NOT_FOUND_MESSAGE, 404, 'NOT_FOUND');
  }
  return { master, client };
}

export async function createOrRefreshProgramRequestLink(master, actor = {}) {
  const programName = trimStr(master?.programName);
  const campName = trimStr(master?.campName);
  if (!programName || !campName) {
    throw new AppError(
      'Save Division / Therapy and Method before copying the request form link',
      400,
      'VALIDATION_ERROR',
    );
  }
  if (master.isActive === false) {
    throw new AppError(
      'Activate this program before copying the request form link',
      400,
      'VALIDATION_ERROR',
    );
  }

  let token = '';
  let hash = '';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    token = mintExecutionToken();
    hash = hashExecutionToken(token);
    const clash = await CampOpsClientMaster.findOne({
      requestFormTokenHash: hash,
      isDeleted: false,
      _id: { $ne: master._id },
    });
    if (!clash) break;
    token = '';
    hash = '';
  }
  if (!token || !hash) {
    throw new AppError('Could not create camp request form link', 500, 'LINK_MINT_FAILED');
  }

  master.requestFormTokenHash = hash;
  master.requestFormTokenCreatedAt = new Date().toISOString();
  if (actor?.id || actor?._id) {
    master.updatedById = actor.id || actor._id;
  }
  await master.save();

  const links = programRequestFormUrl(token);
  return {
    token,
    ...links,
    createdAt: master.requestFormTokenCreatedAt,
  };
}

function assertRawDoctorName(body = {}) {
  if (body.doctorName === undefined || body.doctorName === null) return;
  const error = getDoctorNameFormatError(trimStr(body.doctorName));
  if (error) throw new AppError(error, 400, 'VALIDATION_ERROR');
}

function buildCampFromProgramForm(safeBody, client, pricing) {
  const clientMasterDurationHours = parseCampDurationToHours(pricing?.campDuration);
  const schedule = resolveCampSchedule({
    startTime: safeBody.startTime || '09:00',
    endTime: safeBody.endTime || '',
    durationHours: safeBody.durationHours ?? (clientMasterDurationHours || 4),
  });
  const campDate = parseLocalDateInput(safeBody.campDate) || trimStr(safeBody.campDate);
  if (!campDate) throw new AppError('Camp date is required', 400, 'VALIDATION_ERROR');
  const campAddress = trimStr(safeBody.campAddress);
  const latRaw = safeBody.latitude;
  const lngRaw = safeBody.longitude;

  const payload = formatCampTextPayload({
    clientId: client._id,
    clientName: client.name,
    campaignId: null,
    campaignName: normalizeCampName(safeBody.campaignName || 'BMD'),
    campaignType: trimStr(safeBody.campaignType),
    doctorName: trimStr(safeBody.doctorName),
    doctorCode: trimStr(safeBody.doctorCode),
    scCode: '',
    mslNo: '',
    speciality: trimStr(safeBody.speciality) || 'General Practitioner',
    hospitalName: '',
    clinicName: '',
    campAddress,
    googlePlaceId: trimStr(safeBody.googlePlaceId),
    addressManualEntry: true,
    city: trimStr(safeBody.city),
    state: trimStr(safeBody.state),
    district: trimStr(safeBody.district),
    pincode: trimStr(safeBody.pincode),
    latitude: latRaw !== undefined && latRaw !== '' ? Number(latRaw) : null,
    longitude: lngRaw !== undefined && lngRaw !== '' ? Number(lngRaw) : null,
    campDate,
    ...schedule,
    expectedPatients: Math.max(0, Number(safeBody.expectedPatients ?? 0) || 0),
    actualPatients: 0,
    ...resolveContactPersonFields(safeBody, null),
    source: CAMP_OPS_SOURCES.includes(PROGRAM_REQUEST_FORM_SOURCE)
      ? PROGRAM_REQUEST_FORM_SOURCE
      : 'dashboard',
    remarks: trimStr(safeBody.remarks),
    ...lifecyclePayloadFromBody(safeBody, null, { pricing, allowExplicitExecutionStatus: false }),
  });

  payload.source = PROGRAM_REQUEST_FORM_SOURCE;
  payload.lifecycleStage = 'request';
  payload.clientId = client._id;
  payload.clientName = client.name;
  payload.campaignType = trimStr(safeBody.campaignType);
  payload.campaignName = normalizeCampName(safeBody.campaignName || 'BMD');
  return payload;
}

export function isBlankProgramFormRow(row = {}) {
  return PROGRAM_FORM_IMPORT_KEYS.every((key) => !trimStr(row[key]));
}

export function missingProgramFormImportColumns(mapping = {}) {
  const missing = [];
  const contactKeys = new Set(['contactPersonLevel', 'fieldPersonName', 'fieldPersonPhone']);
  for (const field of PROGRAM_FORM_SAMPLE_FIELDS) {
    if (!field.required || contactKeys.has(field.key)) continue;
    if (!mapping[field.key]) missing.push(field.label);
  }
  const hasFormContact = mapping.fieldPersonName && mapping.fieldPersonPhone;
  const hasLevelContact = CONTACT_LEVEL_IMPORT_FIELDS.some(
    (field) => mapping[field.nameKey] && mapping[field.phoneKey],
  );
  if (!hasFormContact && !hasLevelContact) {
    missing.push('Contact Person Name', 'Contact Person Number');
  }
  return missing;
}

export function normalizeProgramFormImportRow(row = {}) {
  return {
    ...row,
    campDate: parseLocalDateInput(row.campDate) || trimStr(row.campDate),
    startTime: normalizePasteStartTime(row.startTime) || trimStr(row.startTime),
    endTime: normalizePasteStartTime(row.endTime) || trimStr(row.endTime),
    expectedPatients: trimStr(row.expectedPatients),
  };
}

async function createProgramCampFromBody(master, client, body = {}) {
  const safeBody = sanitizeProgramRequestBody(body, { client, master });
  assertRawDoctorName(safeBody);

  let pricing = null;
  try {
    pricing = await resolveClientMasterPricingForCamp(client._id, {
      campaignType: safeBody.campaignType,
      campaignName: safeBody.campaignName,
      clientName: client.name,
    });
  } catch {
    pricing = null;
  }

  const payload = buildCampFromProgramForm(safeBody, client, pricing);
  try {
    assertRequestStageComplete({
      ...payload,
      clientId: client._id,
      clientName: client.name,
    }, { skipLocation: true });
  } catch (err) {
    throw new AppError(err.message || 'Complete all request stage fields', 400, 'VALIDATION_ERROR');
  }

  assertHistoricalCampDatesAllowed(null, [], {
    campDate: payload.campDate,
    requestDate: payload.requestDate,
  });

  const tracking = captureSubmissionTracking();
  let camp;
  try {
    camp = await createCampEnsuringNoDuplicate(CampOpsCamp, {
      ...payload,
      campId: await generateCampId(payload.campDate),
      status: 'pending_review',
      lifecycleStage: 'request',
      requestDate: payload.requestDate || new Date().toISOString().slice(0, 10),
      createdById: null,
      createdByEmail: 'program-form',
      requestReviewStatus: 'review_pending',
      ...tracking,
    }, {
      client,
      row: {
        clientName: client.name,
        doctorName: payload.doctorName,
        campaignType: payload.campaignType,
        campDate: payload.campDate,
        startTime: payload.startTime,
      },
    });
  } catch (err) {
    if (err instanceof CampDuplicateError) {
      throw new AppError(err.message, 409, 'DUPLICATE_CAMP');
    }
    throw err;
  }

  return camp;
}

export async function submitProgramCampRequest(rawToken, body = {}) {
  const { master, client } = await resolveProgramByRequestToken(rawToken);
  return createProgramCampFromBody(master, client, body);
}

export async function importProgramFormFile(rawToken, file) {
  const { master, client } = await resolveProgramByRequestToken(rawToken);
  const parsed = await parsePasteImportFile(file, { fieldKeys: PROGRAM_FORM_IMPORT_KEYS });
  if (!parsed.rows?.length) {
    throw importAppError('NO_DATA_ROWS');
  }
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    throw importAppError('TOO_MANY_ROWS');
  }

  const missing = missingProgramFormImportColumns(parsed.mapping || {});
  if (missing.length) {
    throw new AppError(
      `The file is missing required columns: ${missing.join(', ')}. Download the sample template and try again.`,
      400,
      'VALIDATION_ERROR',
    );
  }

  const mappedRows = mapRows(parsed.rows, parsed.mapping);
  const created = [];
  const skipped = [];
  const failed = [];

  for (const mapped of mappedRows) {
    const rowNumber = mapped.rowNumber || created.length + skipped.length + failed.length + 2;
    if (isBlankProgramFormRow(mapped)) continue;
    const row = normalizeProgramFormImportRow(mapped);
    try {
      const camp = await createProgramCampFromBody(master, client, row);
      created.push({
        rowNumber,
        campId: camp.campId,
        id: camp._id,
      });
    } catch (err) {
      if (err instanceof CampDuplicateError || err.code === 'DUPLICATE_CAMP') {
        skipped.push({
          rowNumber,
          campId: err.existingCamp?.campId || '',
          reason: err.message,
          skipReason: 'duplicate',
        });
        continue;
      }
      failed.push({
        rowNumber,
        reason: err.message || 'Could not import this row',
      });
    }
  }

  if (!created.length && !skipped.length && !failed.length) {
    throw importAppError('NO_DATA_ROWS');
  }

  return {
    summary: {
      created: created.length,
      skipped: skipped.length,
      skippedDuplicates: skipped.filter((row) => row.skipReason === 'duplicate').length,
      failed: failed.length,
    },
    created,
    skipped,
    failed,
  };
}

export async function lookupProgramFormPin(pinCode) {
  const pin = String(pinCode || '').replace(/\D+/g, '');
  if (pin.length !== 6) {
    throw new AppError('PIN code must be 6 digits', 400, 'VALIDATION_ERROR');
  }
  const rows = await GeoPinCode.find({ pinCode: pin, isDeleted: false, isActive: true }).limit(20);
  const data = (await enrichPinRecords(rows)).filter(Boolean);
  return { data, resolved: data[0] || null };
}

export async function listProgramFormStates() {
  const rows = await GeoState.find({ isDeleted: false, isActive: true }).sort('name').limit(100);
  return rows.map(publicGeoRow).filter(Boolean);
}

export async function listProgramFormDistricts(stateId) {
  const id = String(stateId || '').trim();
  if (!id) throw new AppError('stateId is required', 400, 'VALIDATION_ERROR');
  const rows = await GeoDistrict.find({ isDeleted: false, isActive: true, stateId: id })
    .sort('name')
    .limit(500);
  return rows.map(publicGeoRow).filter(Boolean);
}

export async function listProgramFormCities(stateId) {
  const id = String(stateId || '').trim();
  if (!id) throw new AppError('stateId is required', 400, 'VALIDATION_ERROR');
  const rows = await GeoCity.find({ isDeleted: false, isActive: true, stateId: id })
    .sort('name')
    .limit(5000);
  return rows.map(publicGeoRow).filter(Boolean);
}
