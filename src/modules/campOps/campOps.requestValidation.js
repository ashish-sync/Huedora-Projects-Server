import { trimStr, computeDurationHours } from './campOps.helpers.js';
import { resolveCampSlot } from './campOps.lifecycle.js';
import { CAMP_OPS_SOURCES } from './campOps.constants.js';
import { resolveZoneNameForState } from '../geo/geo.zones.js';

export const REQUEST_PARTIAL_THRESHOLD = 0.6;

function hasText(value) {
  return Boolean(trimStr(value));
}

function phoneDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
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
  { key: 'expectedPatients', test: (c) => Number(c.expectedPatients) > 0 },
  { key: 'fieldPersonName', test: (c) => hasText(c.fieldPersonName) },
  {
    key: 'fieldPersonPhone',
    test: (c) => {
      const phone = phoneDigits(c.fieldPersonPhone);
      return phone.length >= 6 && phone.length <= 15;
    },
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

  const expectedPatients = Number(camp.expectedPatients);
  if (!Number.isFinite(expectedPatients) || expectedPatients <= 0) {
    errors.push('Expected patients must be greater than zero');
  }

  if (!hasText(camp.fieldPersonName)) errors.push('Contact person name is required');
  const phone = phoneDigits(camp.fieldPersonPhone);
  if (phone.length < 6 || phone.length > 15) {
    errors.push('Contact person number must be 6–15 digits');
  }

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
