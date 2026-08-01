import { trimStr, computeDurationHours } from './campOps.helpers.js';
import { resolveCampSlot } from './campOps.lifecycle.js';
import { CAMP_OPS_SOURCES, CONTACT_PERSON_LEVELS } from './campOps.constants.js';
import { resolveZoneNameForState } from '../geo/geo.zones.js';
import { isValidPhone } from '../../utils/identityNormalize.js';
import { normalizeContactPersons } from './campContactPersons.js';
import { getDoctorNameFormatError } from '../../utils/textFormat.js';

export const REQUEST_PARTIAL_THRESHOLD = 0.6;

/** Manual paste: at least one substantive field from pasted text (not context defaults). */
const PASTE_PARTIAL_ANCHOR_KEYS = [
  'doctorName',
  'doctorCode',
  'campDate',
  'campAddress',
  'pincode',
  'city',
  'state',
  'district',
  'hq',
  'expectedPatients',
  'contactPersons',
];

function hasText(value) {
  return Boolean(trimStr(value));
}

function hasPasteAnchorField(camp = {}) {
  return PASTE_PARTIAL_ANCHOR_KEYS.some((key) => {
    if (key === 'pincode') return /^\d{6}$/.test(trimStr(camp.pincode));
    if (key === 'expectedPatients') {
      const raw = String(camp.expectedPatients ?? '').trim();
      return raw !== '' && /^\d+$/.test(raw) && Number(raw) > 0;
    }
    if (key === 'contactPersons') {
      return normalizeContactPersons(camp).some(
        (contact) => hasText(contact.name) || isValidPhone(contact.phone),
      );
    }
    return hasText(camp[key]);
  });
}

/** Paste imports may create incomplete camps when a few fields were captured from text. */
export function isPastePartialImportEligible(camp = {}) {
  const completion = getRequestStageCompletion(camp);
  if (completion.complete) return false;
  return hasPasteAnchorField(camp);
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
