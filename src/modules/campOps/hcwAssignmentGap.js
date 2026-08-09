import { CampOpsCamp } from './campOps.model.js';
import {
  formatMinutes,
  parseLocalDateInput,
  parseTimeToMinutes,
  resolveCampSchedule,
  trimStr,
} from './campOps.helpers.js';

/** Minimum gap between one camp's end and the next camp's start for the same HCW. */
export const HCW_ASSIGNMENT_GAP_MINUTES = 90;

function isActiveHcwAssignedCamp(camp = {}) {
  if (['cancelled', 'rejected'].includes(trimStr(camp.status))) return false;
  if (!trimStr(camp.hcwContactId)) return false;
  if (trimStr(camp.assignmentDecision) === 'refuse') return false;
  return true;
}

function scheduleBounds(camp = {}) {
  const schedule = resolveCampSchedule({
    startTime: camp.startTime,
    endTime: camp.endTime,
    durationHours: camp.durationHours,
  });
  const startMinutes = parseTimeToMinutes(schedule.startTime);
  const endMinutes = parseTimeToMinutes(schedule.endTime);
  if (startMinutes == null || endMinutes == null) return null;
  return {
    startMinutes,
    endMinutes: endMinutes <= startMinutes ? endMinutes + 24 * 60 : endMinutes,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
  };
}

function campLabel(camp = {}) {
  return trimStr(camp.campId) || trimStr(camp._id) || 'another camp';
}

/**
 * Pure check: candidate vs other same-day HCW camps.
 * Returns null when OK, or { message, conflictingCamp, earliestStartTime }.
 */
export function findHcwAssignmentGapConflict(
  candidate = {},
  others = [],
  { gapMinutes = HCW_ASSIGNMENT_GAP_MINUTES } = {},
) {
  if (!isActiveHcwAssignedCamp(candidate)) return null;

  const candidateDate = parseLocalDateInput(candidate.campDate)
    || trimStr(candidate.campDate).slice(0, 10);
  if (!candidateDate) return null;

  const candidateBounds = scheduleBounds(candidate);
  if (!candidateBounds) return null;

  const peers = (Array.isArray(others) ? others : [])
    .filter((camp) => {
      if (!isActiveHcwAssignedCamp(camp)) return false;
      if (String(camp.hcwContactId) !== String(candidate.hcwContactId)) return false;
      if (String(camp._id || '') && String(candidate._id || '')
        && String(camp._id) === String(candidate._id)) {
        return false;
      }
      const date = parseLocalDateInput(camp.campDate) || trimStr(camp.campDate).slice(0, 10);
      return date === candidateDate;
    })
    .map((camp) => ({ camp, bounds: scheduleBounds(camp) }))
    .filter((entry) => entry.bounds);

  const ordered = [
    { camp: candidate, bounds: candidateBounds, isCandidate: true },
    ...peers.map((entry) => ({ ...entry, isCandidate: false })),
  ].sort((a, b) => {
    if (a.bounds.startMinutes !== b.bounds.startMinutes) {
      return a.bounds.startMinutes - b.bounds.startMinutes;
    }
    return a.bounds.endMinutes - b.bounds.endMinutes;
  });

  for (let i = 0; i < ordered.length - 1; i += 1) {
    const earlier = ordered[i];
    const later = ordered[i + 1];
    const earliestAllowed = earlier.bounds.endMinutes + gapMinutes;
    if (later.bounds.startMinutes >= earliestAllowed) continue;

    // Only report when the candidate is involved in the violating pair.
    if (!earlier.isCandidate && !later.isCandidate) continue;

    const conflicting = earlier.isCandidate ? later.camp : earlier.camp;
    const earliestStartTime = formatMinutes(earliestAllowed);
    const earlierEnd = earlier.bounds.endTime;
    const pin = trimStr(conflicting.pincode);
    const pinSuffix = pin ? `, PIN ${pin}` : '';
    const windowLabel = `${earlier.bounds.startTime}–${earlierEnd}${pinSuffix}`;
    const message = earlier.isCandidate
      ? `This camp ends at ${earlierEnd}. The next camp for this HCW on the same date (${campLabel(conflicting)}${pinSuffix}) must start at ${earliestStartTime} or later (1 hour 30 minutes gap required).`
      : `This HCW already has camp ${campLabel(conflicting)} (${windowLabel}) until ${earlierEnd}. Earliest allowed start for this camp is ${earliestStartTime} (1 hour 30 minutes after that camp ends).`;

    return {
      message,
      conflictingCamp: conflicting,
      earliestStartTime,
      gapMinutes,
    };
  }

  return null;
}

/**
 * Load same-HCW camps and assert the 90-minute gap rule.
 * Throws Error with a clear message when violated.
 */
export async function assertHcwAssignmentGap(candidate = {}) {
  if (!isActiveHcwAssignedCamp(candidate)) return;

  const hcwContactId = trimStr(candidate.hcwContactId);
  const campDate = parseLocalDateInput(candidate.campDate)
    || trimStr(candidate.campDate).slice(0, 10);
  if (!hcwContactId || !campDate) return;

  const rows = await CampOpsCamp.find({
    hcwContactId,
    status: { $nin: ['cancelled', 'rejected'] },
  });

  const conflict = findHcwAssignmentGapConflict(candidate, rows);
  if (conflict) {
    const err = new Error(conflict.message);
    err.code = 'HCW_ASSIGNMENT_GAP';
    err.conflict = conflict;
    throw err;
  }
}
