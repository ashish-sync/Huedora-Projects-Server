import { CampOpsCamp } from './campOps.model.js';
import { escapeRegex, parseLocalDateInput, trimStr } from './campOps.helpers.js';
import { normalizePasteStartTime } from './pasteTimeNormalize.js';
import { stripDoctorNamePrefix } from '../../utils/textFormat.js';

export const DUPLICATE_CAMP_MESSAGE =
  'Duplicate Entry — A camp already exists with the same Client, Doctor, Division/Campaign Type, Camp Date and Start Time.';

/** @deprecated Status is not part of duplicate detection — all non-deleted camps block duplicates. */
export const DUPLICATE_BLOCKING_STATUSES = ['pending_review', 'approved', 'executed'];

export const DUPLICATE_KEY_LABEL = 'client, doctor, division, date, and start time';

export class CampDuplicateError extends Error {
  constructor(existingCamp) {
    super(DUPLICATE_CAMP_MESSAGE);
    this.name = 'CampDuplicateError';
    this.code = 'DUPLICATE_CAMP';
    this.existingCamp = existingCamp;
  }
}

export function normalizeCampaignType(value = '') {
  return String(trimStr(value) || '').toLowerCase();
}

export function normalizeCampStartTime(value = '') {
  const raw = trimStr(value);
  if (!raw) return '';
  return normalizePasteStartTime(raw) || raw.replace(/\./g, ':').toLowerCase();
}

export function normalizeClientName(value = '') {
  return String(trimStr(value) || '').toLowerCase();
}

export function normalizeDoctorName(value = '') {
  return String(stripDoctorNamePrefix(value) || trimStr(value) || '')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function buildCampDuplicateKey({
  clientId = '',
  clientName = '',
  doctorName = '',
  campaignType = '',
  campDate = '',
  startTime = '',
} = {}) {
  const date = parseLocalDateInput(campDate) || '';
  const time = normalizeCampStartTime(startTime);
  const division = normalizeCampaignType(campaignType);
  const doctor = normalizeDoctorName(doctorName);
  const clientKey = String(clientId || '').trim().toLowerCase()
    || normalizeClientName(clientName);
  if (!clientKey || !doctor || !division || !date || !time) return '';
  return [clientKey, doctor, division, date, time].join('\0');
}

export function campaignTypesMatch(row = {}, camp = {}) {
  const rowType = normalizeCampaignType(row.campaignType);
  const campType = normalizeCampaignType(camp.campaignType);
  if (!rowType || !campType) return false;
  return rowType === campType;
}

export function startTimesMatch(row = {}, camp = {}) {
  const rowTime = normalizeCampStartTime(row.startTime);
  const campTime = normalizeCampStartTime(camp.startTime);
  if (!rowTime || !campTime) return false;
  return rowTime === campTime;
}

export function doctorsMatch(row = {}, camp = {}) {
  const rowDoctor = normalizeDoctorName(row.doctorName);
  const campDoctor = normalizeDoctorName(camp.doctorName);
  if (!rowDoctor || !campDoctor) return false;
  return rowDoctor === campDoctor;
}

export function clientsMatch(client = {}, camp = {}) {
  const clientId = String(client?._id || client?.id || '').trim();
  const campClientId = String(camp?.clientId || '').trim();
  if (clientId && campClientId && clientId.toLowerCase() === campClientId.toLowerCase()) {
    return true;
  }
  const clientName = normalizeClientName(client?.name || client?.clientName);
  const campName = normalizeClientName(camp?.clientName);
  return Boolean(clientName && campName && clientName === campName);
}

export function duplicateRowFromCamp(camp = {}, client = null) {
  return {
    clientName: client?.name || camp.clientName,
    doctorName: camp.doctorName,
    campaignType: camp.campaignType,
    campDate: camp.campDate,
    startTime: camp.startTime,
  };
}

export function attachDuplicateKey(doc = {}, { client = null } = {}) {
  const key = buildCampDuplicateKey({
    clientId: doc.clientId || client?._id || client?.id,
    clientName: doc.clientName || client?.name,
    doctorName: doc.doctorName,
    campaignType: doc.campaignType,
    campDate: doc.campDate,
    startTime: doc.startTime,
  });
  if (key) doc.duplicateKey = key;
  return doc;
}

function isExcludedCamp(camp, { excludeCampId = null, excludeId = null } = {}) {
  if (excludeId && String(camp._id) === String(excludeId)) return true;
  if (excludeCampId && String(camp.campId) === String(excludeCampId)) return true;
  return false;
}

function campMatchesDuplicateRow(row, camp) {
  return (
    campaignTypesMatch(row, camp)
    && startTimesMatch(row, camp)
    && doctorsMatch(row, camp)
  );
}

/**
 * Duplicate = Client + Doctor Name + Division/Therapy + Camp Date + Camp Start Time
 * against all non-deleted camps regardless of stage or status.
 */
export async function findExistingDuplicateCamp({
  client,
  row,
  excludeCampId = null,
  excludeId = null,
} = {}) {
  const campDate = parseLocalDateInput(row?.campDate);
  if (!campDate) return null;

  const startTime = normalizeCampStartTime(row?.startTime);
  if (!startTime) return null;

  const campaignType = trimStr(row?.campaignType);
  if (!campaignType) return null;

  const doctorName = trimStr(row?.doctorName);
  if (!doctorName) return null;

  const duplicateKey = buildCampDuplicateKey({
    clientId: client?._id || client?.id,
    clientName: client?.name || row?.clientName,
    doctorName,
    campaignType,
    campDate,
    startTime,
  });

  if (duplicateKey) {
    const keyed = await CampOpsCamp.find({ isDeleted: false, duplicateKey });
    const keyedHit = keyed.find(
      (camp) => !isExcludedCamp(camp, { excludeCampId, excludeId }),
    );
    if (keyedHit) return keyedHit;
  }

  const filter = {
    isDeleted: false,
    campDate,
  };

  if (client?._id) {
    filter.clientId = String(client._id);
  } else if (client?.name || row?.clientName) {
    const name = trimStr(client?.name || row?.clientName);
    filter.clientName = new RegExp(`^${escapeRegex(name)}$`, 'i');
  } else {
    return null;
  }

  const candidates = await CampOpsCamp.find(filter);
  return (
    candidates.find(
      (camp) => (
        !isExcludedCamp(camp, { excludeCampId, excludeId })
        && campMatchesDuplicateRow(row, camp)
      ),
    ) || null
  );
}

export async function assertNoDuplicateCamp({
  client,
  row,
  excludeCampId = null,
  excludeId = null,
} = {}) {
  const duplicate = await findExistingDuplicateCamp({
    client,
    row,
    excludeCampId,
    excludeId,
  });
  if (duplicate) throw new CampDuplicateError(duplicate);
}

const duplicateKeyLocks = new Map();

export async function withDuplicateKeyLock(key, fn) {
  if (!key) return fn();
  const prev = duplicateKeyLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  duplicateKeyLocks.set(key, prev.then(() => gate));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (duplicateKeyLocks.get(key) === gate) duplicateKeyLocks.delete(key);
  }
}

export function isMongoDuplicateKeyError(err) {
  return err?.code === 11000 && /duplicateKey|camp_duplicate_key_unique/i.test(String(err?.message || ''));
}

export async function createCampEnsuringNoDuplicate(CampModel, doc, { client = null, row = null } = {}) {
  const checkRow = row || duplicateRowFromCamp(doc, client);
  attachDuplicateKey(doc, { client });
  const key = doc.duplicateKey;

  return withDuplicateKeyLock(key, async () => {
    await assertNoDuplicateCamp({ client, row: checkRow });
    try {
      return await CampModel.create(doc);
    } catch (err) {
      if (isMongoDuplicateKeyError(err)) {
        const existing = await findExistingDuplicateCamp({ client, row: checkRow });
        throw new CampDuplicateError(existing || { campId: 'existing camp' });
      }
      throw err;
    }
  });
}

export async function assertNoDuplicateOnCampSave(camp, { client = null } = {}) {
  const resolvedClient = client || { _id: camp.clientId, name: camp.clientName };
  const row = duplicateRowFromCamp(camp, resolvedClient);
  await assertNoDuplicateCamp({
    client: resolvedClient,
    row,
    excludeId: camp._id,
    excludeCampId: camp.campId,
  });
  attachDuplicateKey(camp, { client: resolvedClient });
}

export function buildDuplicatePreviewFlag(existingCamp) {
  if (!existingCamp) return null;
  return {
    campId: existingCamp.campId,
    id: existingCamp._id,
    status: existingCamp.status,
  };
}

export function formatDuplicateCampMessage(_existingCamp) {
  return DUPLICATE_CAMP_MESSAGE;
}

export async function ensureCampDuplicateIndex(mongoDb) {
  if (!mongoDb) return;
  const col = mongoDb.collection('tylo_camp_ops_camps');
  await col.createIndex(
    { duplicateKey: 1 },
    {
      unique: true,
      partialFilterExpression: {
        isDeleted: false,
        duplicateKey: { $type: 'string', $ne: '' },
      },
      name: 'camp_duplicate_key_unique',
    },
  );
}
