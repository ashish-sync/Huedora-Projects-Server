import { normalizeEventTime, weekdayName } from './normalize.js';
import { normalizePastePhone } from '../import/pasteFieldRegistry.js';
import { parseLocalDateInput, trimStr } from '../campOps.helpers.js';

export function validateCampExtractionRow(row = {}, { aiMeta = {} } = {}) {
  const warnings = [...(aiMeta.warnings || [])];
  const conflicts = [...(aiMeta.conflicts || [])];
  const codes = [];

  const campDate = parseLocalDateInput(row.campDate) || trimStr(row.campDate);
  if (row.campDate && !campDate) {
    codes.push('INVALID_DATE');
    warnings.push('Camp date could not be normalized');
  }

  const dayLabel = trimStr(row.dayLabel || row.dayName);
  if (campDate && dayLabel) {
    const expected = weekdayName(campDate);
    const given = dayLabel.toLowerCase().slice(0, 3);
    if (expected && given && !expected.startsWith(given) && !given.startsWith(expected.slice(0, 3))) {
      codes.push('DATE_DAY_MISMATCH');
      conflicts.push(`Date ${campDate} is ${expected}, but source says ${dayLabel}`);
    }
  }

  const start = normalizeEventTime(row.startTime) || trimStr(row.startTime);
  const end = normalizeEventTime(row.endTime) || trimStr(row.endTime);
  if (row.startTime && !start) {
    codes.push('INVALID_START_TIME');
    warnings.push('Start time is invalid');
  }
  if (row.endTime && !end) {
    codes.push('INVALID_END_TIME');
    warnings.push('End time is invalid');
  }
  if (start && end && start > end) {
    codes.push('START_AFTER_END');
    conflicts.push(`Start time ${start} is after end time ${end}`);
  }

  if (row.fieldPersonPhone) {
    const phone = normalizePastePhone(row.fieldPersonPhone);
    if (!phone) {
      codes.push('INVALID_PHONE');
      warnings.push('Contact phone is not a valid Indian mobile number');
    }
  }

  if (row.pincode && !/^\d{6}$/.test(String(row.pincode))) {
    codes.push('INVALID_PINCODE');
    warnings.push('Pincode must be 6 digits');
  }

  const criticalMissing = [];
  if (!campDate) criticalMissing.push('campDate');
  if (!trimStr(row.doctorName)) criticalMissing.push('doctorName');
  if (!/^\d{6}$/.test(String(row.pincode || ''))) criticalMissing.push('pincode');
  if (!start) criticalMissing.push('startTime');
  if (criticalMissing.length) {
    codes.push('MISSING_CRITICAL_FIELDS');
    warnings.push(`Missing mandatory fields: ${criticalMissing.join(', ')}`);
  }

  let status = 'READY';
  if (codes.includes('DATE_DAY_MISMATCH') || codes.includes('START_AFTER_END')) status = 'CONFLICT';
  else if (codes.includes('INVALID_DATE') || codes.includes('INVALID_START_TIME') || codes.includes('INVALID_PINCODE')) {
    status = 'INVALID';
  } else if (criticalMissing.length) status = 'REVIEW_REQUIRED';
  else if (conflicts.length) status = 'AMBIGUOUS';
  else if (warnings.length) status = 'REVIEW_REQUIRED';

  return { codes, warnings, conflicts, status, criticalMissing };
}

/** True when deterministic path is incomplete enough to justify an LLM call. */
export function deterministicNeedsLlmAssist(entry = {}) {
  if (!entry) return true;
  if (entry.historicalDateBlocked) return false;
  if (entry.duplicateOf) return false;
  if (entry.valid) return false;
  // Four mandatory fields present → creatable; optional gaps do not force AI.
  if (entry.partial && entry.creationEligible !== false) {
    const missingMandatory = entry.mandatoryMissing || [];
    if (!missingMandatory.length && entry.creationEligible) return false;
    if (entry.creationEligible) return false;
  }
  if (entry.partial) {
    const missing = entry.partialFields || [];
    const anchors = ['doctorName', 'campDate', 'pincode', 'startTime'];
    return anchors.some((key) => missing.includes(key)) || Boolean(entry.mandatoryMissing?.length);
  }
  // invalid or empty — try AI fallback for missing mandatory fields
  return true;
}

export function isGarbageInput(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return true;
  if (raw.length < 8) return true;
  const alpha = (raw.match(/[A-Za-z]/g) || []).length;
  if (alpha < 4) return true;
  return false;
}
