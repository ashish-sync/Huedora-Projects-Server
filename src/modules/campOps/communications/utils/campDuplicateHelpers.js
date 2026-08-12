/**
 * Compatibility re-exports for communications ingest.
 * Canonical duplicate key: Client + Doctor Name + Division/Therapy + Camp Date + Start Time.
 */
export {
  DUPLICATE_BLOCKING_STATUSES,
  CampDuplicateError,
  normalizeCampaignType,
  normalizeDoctorName,
  campaignTypesMatch,
  startTimesMatch,
  doctorsMatch,
  findExistingDuplicateCamp,
  buildDuplicatePreviewFlag,
  formatDuplicateCampMessage,
  buildCampDuplicateKey,
  normalizeCampStartTime,
} from '../../campDuplicate.js';

/** @deprecated Doctor code is not part of the duplicate key. */
export function normalizeDoctorCode(value = '') {
  return String(value || '').trim().toLowerCase();
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
