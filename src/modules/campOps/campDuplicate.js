import { CampOpsCamp } from './campOps.model.js';
import { escapeRegex, parseLocalDateInput, trimStr } from './campOps.helpers.js';
import { normalizePasteStartTime } from './pasteTimeNormalize.js';
import { stripDoctorNamePrefix } from '../../utils/textFormat.js';

export const DUPLICATE_BLOCKING_STATUSES = ['pending_review', 'approved', 'executed'];

export const DUPLICATE_KEY_LABEL = 'client, doctor, division, date, and start time';

export class CampDuplicateError extends Error {
  constructor(existingCamp) {
    const label = existingCamp?.campId || 'existing camp';
    super(
      `Duplicate camp already exists (${label}) for the same ${DUPLICATE_KEY_LABEL}`,
    );
    this.name = 'CampDuplicateError';
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

/**
 * Duplicate = Client + Doctor Name + Division/Therapy + Camp Date + Camp Start Time
 * against non-deleted camps in pending_review / approved / executed.
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

  const filter = {
    isDeleted: false,
    status: { $in: DUPLICATE_BLOCKING_STATUSES },
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
  const filtered = candidates.filter((camp) => {
    if (excludeId && String(camp._id) === String(excludeId)) return false;
    if (excludeCampId && String(camp.campId) === String(excludeCampId)) return false;
    return true;
  });

  return (
    filtered.find(
      (camp) => (
        campaignTypesMatch(row, camp)
        && startTimesMatch(row, camp)
        && doctorsMatch(row, camp)
      ),
    ) || null
  );
}

export function buildDuplicatePreviewFlag(existingCamp) {
  if (!existingCamp) return null;
  return {
    campId: existingCamp.campId,
    id: existingCamp._id,
    status: existingCamp.status,
  };
}

export function formatDuplicateCampMessage(existingCamp) {
  const label = existingCamp?.campId || 'existing camp';
  return `Duplicate of existing camp ${label} for same ${DUPLICATE_KEY_LABEL}`;
}
