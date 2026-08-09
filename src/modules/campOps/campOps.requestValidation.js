import { trimStr, computeDurationHours } from './campOps.helpers.js';
import { resolveCampSlot } from './campOps.lifecycle.js';
import { CAMP_OPS_SOURCES, CONTACT_PERSON_LEVELS } from './campOps.constants.js';
import { resolveZoneNameForState } from '../geo/geo.zones.js';
import { isValidPhone } from '../../utils/identityNormalize.js';
import { normalizeContactPersons } from './campContactPersons.js';
import { getDoctorNameFormatError } from '../../utils/textFormat.js';
import { normalizePasteStartTime } from './pasteTimeNormalize.js';

export const REQUEST_PARTIAL_THRESHOLD = 0.6;

/**
 * Manual Paste creation gate (only these four). Everything else is optional enrichment.
 * Full request-stage blockers still apply later for approval completeness.
 */
export const PASTE_CREATION_MANDATORY_KEYS = [
  'doctorName',
  'pincode',
  'campDate',
  'startTime',
];

const PASTE_CREATION_FIELD_LABELS = {
  doctorName: 'Doctor Name',
  pincode: 'PIN Code',
  campDate: 'Camp Date',
  startTime: 'Camp Start Time',
};

function hasText(value) {
  return Boolean(trimStr(value));
}

function isValidPasteStartTime(value) {
  return Boolean(normalizePasteStartTime(value));
}

/**
 * Blockers for Manual Paste camp creation. Missing optional fields never appear here.
 * Does not invent values — callers must not default mandatory fields before this check.
 */
export function getPasteCreationBlockers(camp = {}) {
  const errors = [];
  const normalized = normalizePasteCreationRow(camp);

  if (!hasText(normalized.doctorName)) {
    errors.push('Doctor name is required');
  } else {
    const doctorNameError = getDoctorNameFormatError(normalized.doctorName);
    if (doctorNameError && doctorNameError !== 'Doctor name is required') {
      errors.push(doctorNameError);
    }
  }

  if (!/^\d{6}$/.test(trimStr(normalized.pincode))) {
    errors.push('Valid 6-digit PIN code is required');
  }

  if (!hasText(normalized.campDate)) {
    errors.push('Camp date is required');
  }

  if (!hasText(normalized.startTime)) {
    errors.push('Camp start time is required');
  } else if (!isValidPasteStartTime(normalized.startTime)) {
    errors.push('Camp start time is invalid');
  }

  return errors;
}

/** Normalize paste row fields used by the 4-field creation gate (no invention). */
export function normalizePasteCreationRow(row = {}) {
  const startTime = normalizePasteStartTime(row.startTime) || trimStr(row.startTime);
  return {
    ...row,
    doctorName: trimStr(row.doctorName),
    pincode: trimStr(row.pincode),
    campDate: trimStr(row.campDate),
    startTime,
  };
}

export function isPasteCreationEligible(camp = {}) {
  return getPasteCreationBlockers(camp).length === 0;
}

export function getPasteCreationMissingKeys(camp = {}) {
  const normalized = normalizePasteCreationRow(camp);
  const missing = [];
  if (!hasText(normalized.doctorName)) missing.push('doctorName');
  if (!/^\d{6}$/.test(trimStr(normalized.pincode))) missing.push('pincode');
  if (!hasText(normalized.campDate)) missing.push('campDate');
  if (!hasText(normalized.startTime) || !isValidPasteStartTime(normalized.startTime)) {
    missing.push('startTime');
  }
  return missing;
}

export function labelPasteCreationField(key) {
  return PASTE_CREATION_FIELD_LABELS[key] || key;
}

/**
 * Paste may create when the four mandatory fields are present+valid,
 * even if optional enrichment / full request-stage fields are incomplete.
 */
export function isPastePartialImportEligible(camp = {}) {
  const completion = getRequestStageCompletion(camp);
  if (completion.complete) return false;
  return isPasteCreationEligible(camp);
}

/** Required request-stage checks used for completion percentage (paste partial import). */
const REQUEST_COMPLETION_CHECKS = [
  { key: 'source', test: (c) => hasText(c.source) && CAMP_OPS_SOURCES.includes(trimStr(c.source)) },
  { key: 'client', test: (c) => Boolean(c.clientId) || hasText(c.clientName) },
  { key: 'campaignType', test: (c) => hasText(c.campaignType) },
  { key: 'campaignName', test: (c) => hasText(c.campaignName) },
  { key: 'campDate', test: (c) => hasText(c.campDate) },
  { key: 'startTime', test: (c) => hasText(c.startTime) },
  { key: 'endTime', test: (c) => hasText(c.endTime) },
  { key: 'doctorName', test: (c) => hasText(c.doctorName) },
  { key: 'doctorCode', test: (c) => hasText(c.doctorCode) },
  { key: 'campAddress', test: (c) => hasText(c.campAddress) },
  { key: 'state', test: (c) => hasText(c.state) },
  { key: 'district', test: (c) => hasText(c.district) },
  { key: 'city', test: (c) => hasText(c.city) },
  { key: 'pincode', test: (c) => /^\d{6}$/.test(trimStr(c.pincode)) },
  { key: 'hq', test: (c) => hasText(c.hq) },
  { key: 'zone', test: (c) => hasText(c.zone) },
  { key: 'expectedPatients', test: (c) => /^\d+$/.test(String(c.expectedPatients ?? '').trim()) },
  {
    key: 'contactPersons',
    test: (c) => normalizeContactPersons(c).every(
      (contact) => hasText(contact.name)
        && CONTACT_PERSON_LEVELS.includes(trimStr(contact.level))
        && isValidPhone(contact.phone),
    ),
  },
];

export function getRequestStageBlockers(camp = {}) {
  const errors = [];
  const source = trimStr(camp.source);
  if (!source || !CAMP_OPS_SOURCES.includes(source)) {
    errors.push('Source of request is required');
  }
  if (!camp.clientId && !hasText(camp.clientName)) errors.push('Client name is required');
  if (!hasText(camp.campaignType)) errors.push('Division / therapy is required');
  if (!hasText(camp.campaignName)) errors.push('Method is required');
  if (!hasText(camp.campDate)) errors.push('Camp date is required');

  const startTime = trimStr(camp.startTime);
  const endTime = trimStr(camp.endTime);
  if (!startTime) errors.push('Camp start time is required');
  if (!endTime) errors.push('Camp end time is required');
  if (startTime && endTime) {
    const duration = computeDurationHours(startTime, endTime);
    if (!Number.isFinite(duration) || duration <= 0) {
      errors.push('Camp end time must be after start time');
    }
  }
  if (startTime && !resolveCampSlot(startTime)) {
    errors.push('Camp start time must fall within Morning, Noon, or Evening slot hours');
  }

  if (!hasText(camp.doctorName)) errors.push('Doctor name is required');
  else {
    const doctorNameError = getDoctorNameFormatError(camp.doctorName);
    if (doctorNameError && doctorNameError !== 'Doctor name is required') {
      errors.push(doctorNameError);
    }
  }
  if (!hasText(camp.doctorCode)) errors.push('Doctor code is required');
  if (!hasText(camp.campAddress)) errors.push('Camp address is required');
  if (!hasText(camp.state)) errors.push('State is required');
  if (!hasText(camp.district)) errors.push('District is required');
  if (!hasText(camp.city)) errors.push('City is required');
  if (!/^\d{6}$/.test(trimStr(camp.pincode))) errors.push('Valid 6-digit pin code is required');
  if (!hasText(camp.hq)) errors.push('HQ is required');
  const stateName = trimStr(camp.state);
  const zone = trimStr(camp.zone);
  if (!zone) {
    errors.push('Zone is required');
  } else if (stateName) {
    const expected = resolveZoneNameForState(stateName);
    if (expected && expected !== zone) {
      errors.push(`Zone must be ${expected} for ${stateName}`);
    }
  }

  const expectedPatientsRaw = String(camp.expectedPatients ?? '').trim();
  if (!expectedPatientsRaw) {
    errors.push('Expected patients is required');
  } else if (!/^\d+$/.test(expectedPatientsRaw)) {
    errors.push('Expected patients must be a whole number');
  }

  const contacts = normalizeContactPersons(camp);
  if (!contacts.length) {
    errors.push('At least one contact person is required');
  }
  contacts.forEach((contact, index) => {
    const label = contacts.length > 1 ? `Contact person ${index + 1}` : 'Contact person';
    if (!CONTACT_PERSON_LEVELS.includes(trimStr(contact.level))) {
      errors.push(`${label} level is required`);
    }
    if (!hasText(contact.name)) errors.push(`${label} name is required`);
    if (!isValidPhone(contact.phone)) {
      errors.push(`${label} number must be exactly 10 digits`);
    }
  });

  return errors;
}

export function getRequestStageCompletion(camp = {}) {
  const total = REQUEST_COMPLETION_CHECKS.length;
  const filledKeys = REQUEST_COMPLETION_CHECKS.filter(({ test }) => test(camp)).map(({ key }) => key);
  const percent = total ? filledKeys.length / total : 0;
  const blockers = getRequestStageBlockers(camp);
  return {
    percent,
    percentLabel: Math.round(percent * 100),
    filledCount: filledKeys.length,
    total,
    filledKeys,
    missingKeys: REQUEST_COMPLETION_CHECKS.filter(({ key }) => !filledKeys.includes(key)).map(({ key }) => key),
    blockers,
    complete: blockers.length === 0,
    partial: blockers.length > 0 && percent >= REQUEST_PARTIAL_THRESHOLD,
  };
}

export function assertRequestStageComplete(camp = {}) {
  const blockers = getRequestStageBlockers(camp);
  if (blockers.length) {
    const err = new Error(blockers[0]);
    err.blockers = blockers;
    throw err;
  }
}
