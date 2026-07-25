import {
  parseLocalDateInput,
  generateCampId,
  resolveCampSchedule,
  captureSubmissionTracking,
  trimStr,
  computeEndTime,
  parseTimeToMinutes,
  computeDurationHours,
} from '../../campOps.helpers.js';

export {
  parseLocalDateInput,
  generateCampId,
  resolveCampSchedule,
  captureSubmissionTracking,
  computeEndTime,
  parseTimeToMinutes,
  computeDurationHours,
};

export function trimValue(value) {
  return trimStr(value);
}

export function resolveClinicHospitalName(...values) {
  for (const value of values) {
    const text = trimStr(value);
    if (text) return text;
  }
  return '';
}
