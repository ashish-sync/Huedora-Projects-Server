import { trimStr, computeDurationHours } from './campOps.helpers.js';
import { resolveCampSlot } from './campOps.lifecycle.js';
import { CAMP_OPS_SOURCES } from './campOps.constants.js';
import { resolveZoneNameForState } from '../geo/geo.zones.js';

function hasText(value) {
  return Boolean(trimStr(value));
}

function phoneDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

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

export function assertRequestStageComplete(camp = {}) {
  const blockers = getRequestStageBlockers(camp);
  if (blockers.length) {
    const err = new Error(blockers[0]);
    err.blockers = blockers;
    throw err;
  }
}
