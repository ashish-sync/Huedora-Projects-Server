import { CampOpsCamp as Camp } from '../models.js';
import { trimStr } from '../../campOps.helpers.js';

export const DUPLICATE_BLOCKING_STATUSES = ['pending_review', 'approved', 'executed'];

export class CampDuplicateError extends Error {
  constructor(existingCamp) {
    const label = existingCamp?.campId || 'existing camp';
    super(
      `Duplicate camp already exists (${label}) for the same client, division, date, and doctor`,
    );
    this.name = 'CampDuplicateError';
    this.existingCamp = existingCamp;
  }
}

export function normalizeDoctorName(value = '') {
  return String(trimStr(value) || '')
    .replace(/^dr\.?\s*/i, '')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeDoctorCode(value = '') {
  return String(trimStr(value) || '').toLowerCase();
}

export function normalizeCampaignType(value = '') {
  return String(trimStr(value) || '').toLowerCase();
}

export function getCampDayRange(campDate) {
  const date = new Date(campDate);
  if (Number.isNaN(date.getTime())) return null;

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function doctorsMatch(row = {}, camp = {}) {
  const rowCode = normalizeDoctorCode(row.doctorCode);
  const campCode = normalizeDoctorCode(camp.doctorCode);
  if (rowCode && campCode) {
    return rowCode === campCode;
  }

  const rowName = normalizeDoctorName(row.doctorName);
  const campName = normalizeDoctorName(camp.doctorName);
  return Boolean(rowName && campName && rowName === campName);
}

export function campaignTypesMatch(row = {}, camp = {}) {
  const rowType = normalizeCampaignType(row.campaignType);
  const campType = normalizeCampaignType(camp.campaignType);
  if (!rowType || !campType) {
    return rowType === campType;
  }
  return rowType === campType;
}

export async function findExistingDuplicateCamp({ client, row, excludeCampId = null }) {
  if (!client?._id || !row?.campDate) return null;

  const dayRange = getCampDayRange(row.campDate);
  if (!dayRange) return null;

  const doctorCode = normalizeDoctorCode(row.doctorCode);
  const doctorName = normalizeDoctorName(row.doctorName);
  if (!doctorCode && !doctorName) return null;

  const candidates = await Camp.find({
    isDeleted: false,
    status: { $in: DUPLICATE_BLOCKING_STATUSES },
    clientId: client._id,
    campDate: { $gte: dayRange.start, $lte: dayRange.end },
  });

  const filtered = excludeCampId
    ? candidates.filter((camp) => camp.campId !== excludeCampId)
    : candidates;

  return (
    filtered.find(
      (camp) => campaignTypesMatch(row, camp) && doctorsMatch(row, camp),
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
