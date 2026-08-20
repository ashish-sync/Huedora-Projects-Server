import { CampOpsCamp } from './campOps.model.js';
import {
  escapeRegex,
  formatMinutes,
  parseLocalDateInput,
  parseTimeToMinutes,
  trimStr,
} from './campOps.helpers.js';
import { idsEqual, normalizeEntityId } from '../../utils/entityIds.js';

export const DUPLICATE_CAMP_MESSAGE =
  'Duplicate Entry — A camp already exists with the same Client, Doctor, Division/Campaign Type, Camp Date, and Start Time.';

/** @deprecated Status is not part of duplicate detection — all non-deleted camps block duplicates. */
export const DUPLICATE_BLOCKING_STATUSES = ['pending_review', 'approved', 'executed'];

export const DUPLICATE_KEY_LABEL = 'client, doctor, division, date, and start time';

/** Unit separator — Mongo-safe (NUL bytes can truncate index keys / stored values). */
export const DUPLICATE_KEY_SEPARATOR = '\u001f';

export const DUPLICATE_IDENTITY_FIELDS = [
  'clientId',
  'clientName',
  'doctorName',
  'campaignType',
  'campDate',
  'startTime',
];

export class CampDuplicateError extends Error {
  constructor(existingCamp) {
    super(DUPLICATE_CAMP_MESSAGE);
    this.name = 'CampDuplicateError';
    this.code = 'DUPLICATE_CAMP';
    this.existingCamp = existingCamp;
  }
}

export function normalizeCampaignType(value = '') {
  return String(trimStr(value) || '').replace(/\s+/g, ' ').toLowerCase();
}

/** Canonical HH:mm — "9:00", "09:00:00", "9:00 AM", "9.00 AM" → comparable form. */
export function normalizeCampStartTime(value = '') {
  const raw = String(trimStr(value) || '');
  if (!raw) return '';
  const ampm = raw.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)$/i);
  if (ampm) {
    let hours = Number(ampm[1]);
    const minutes = Number(ampm[2] || 0);
    const period = ampm[3].toLowerCase();
    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
    return formatMinutes(hours * 60 + minutes);
  }
  const dotted = raw.match(/^(\d{1,2})\.(\d{2})(?::(\d{2}))?$/);
  if (dotted) {
    return formatMinutes(Number(dotted[1]) * 60 + Number(dotted[2]));
  }
  const mins = parseTimeToMinutes(raw);
  if (mins == null) return raw;
  return formatMinutes(mins);
}

/** Stable identity fingerprint for save-path skip / compare (same rules as duplicateKey). */
export function campIdentityFingerprint(camp = {}, client = null) {
  return buildCampDuplicateKey({
    clientId: camp.clientId || client?._id || client?.id,
    clientName: camp.clientName || client?.name,
    doctorName: camp.doctorName,
    campaignType: camp.campaignType,
    campDate: camp.campDate,
    startTime: camp.startTime,
  });
}

export function normalizeClientName(value = '') {
  return String(trimStr(value) || '').replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeDoctorName(value = '') {
  return String(trimStr(value) || '')
    .replace(/^\s*(dr\.?|doctor)\s+/i, '')
    .replace(/\s+/g, ' ')
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
  const clientKey = normalizeEntityId(clientId) || normalizeClientName(clientName);
  if (!clientKey || !doctor || !division || !date || !time) return '';
  return [clientKey, doctor, division, date, time].join(DUPLICATE_KEY_SEPARATOR);
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
  const clientId = normalizeEntityId(client?._id || client?.id || '');
  const campClientId = normalizeEntityId(camp?.clientId || '');
  if (clientId && campClientId && clientId === campClientId) {
    return true;
  }
  const clientName = normalizeClientName(client?.name || client?.clientName);
  const campName = normalizeClientName(camp?.clientName);
  return Boolean(clientName && campName && clientName === campName);
}

export function campDatesMatch(row = {}, camp = {}) {
  const rowDate = parseLocalDateInput(row?.campDate);
  const campDate = parseLocalDateInput(camp?.campDate);
  if (!rowDate || !campDate) return false;
  return rowDate === campDate;
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
  else if ('duplicateKey' in doc) delete doc.duplicateKey;
  return doc;
}

function identityId(value) {
  if (value && typeof value === 'object') {
    return normalizeEntityId(value._id || value.$oid || value.id || '');
  }
  return normalizeEntityId(value);
}

function isExcludedCamp(camp, { excludeCampId = null, excludeId = null } = {}) {
  if (excludeId && idsEqual(identityId(camp._id), identityId(excludeId))) return true;
  if (excludeCampId && String(camp.campId || '') === String(excludeCampId)) return true;
  return false;
}

function campMatchesDuplicateRow(row, camp, client = null) {
  return (
    clientsMatch(client || { name: row?.clientName, clientName: row?.clientName }, camp)
    && campDatesMatch(row, camp)
    && campaignTypesMatch(row, camp)
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
      (camp) => (
        !isExcludedCamp(camp, { excludeCampId, excludeId })
        && campMatchesDuplicateRow(row, camp, client)
      ),
    );
    if (keyedHit) return keyedHit;
  }

  const filter = {
    isDeleted: false,
    campDate,
  };

  if (client?._id) {
    filter.clientId = normalizeEntityId(client._id) || String(client._id);
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
        && campMatchesDuplicateRow(row, camp, client)
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
  const key = buildCampDuplicateKey({
    clientId: client?._id || client?.id || doc.clientId,
    clientName: client?.name || checkRow?.clientName || doc.clientName,
    doctorName: checkRow?.doctorName,
    campaignType: checkRow?.campaignType,
    campDate: checkRow?.campDate,
    startTime: checkRow?.startTime,
  });
  if (key) doc.duplicateKey = key;

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
