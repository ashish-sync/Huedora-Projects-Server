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

const TERMINAL_CAMP_STATUSES = ['cancelled', 'rejected'];
const TERMINAL_EXECUTION_STATUSES = ['Cancelled', 'Refused', 'Rejected'];

export function isActiveHcwAssignedCamp(camp = {}) {
  if (TERMINAL_CAMP_STATUSES.includes(trimStr(camp.status))) return false;
  if (TERMINAL_EXECUTION_STATUSES.includes(trimStr(camp.executionStatus))) return false;
  if (trimStr(camp.assignmentDecision) === 'refuse') return false;
  if (trimStr(camp.assignmentStatus) === 'Unassigned') return false;
  if (!trimStr(camp.hcwContactId)) return false;
  return true;
}

/** Clear HCW assignment so the worker is immediately available for other camps. */
export function clearCampHcwAssignment(camp = {}) {
  camp.assignmentDecision = 'refuse';
  camp.assignmentStatus = 'Unassigned';
  camp.hcwContactId = null;
  camp.hcwCategory = '';
  camp.hcwName = '';
  camp.hcwContact = '';
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

function formatGapDurationLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

function buildHcwAssignmentGapMessage({
  endsAtTime,
  earliestStartTime,
  gapMinutes,
  isCandidate,
}) {
  const gapLabel = formatGapDurationLabel(gapMinutes);
  if (isCandidate) {
    return `HCW Schedule Conflict: This camp is scheduled until ${endsAtTime}. A mandatory ${gapLabel} gap is required before the next camp for this HCW, so the earliest available start time for that camp is ${earliestStartTime}.`;
  }
  return `HCW Schedule Conflict: This HCW has another camp scheduled until ${endsAtTime}. A mandatory ${gapLabel} gap is required, so the earliest available start time is ${earliestStartTime}.`;
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
    const message = buildHcwAssignmentGapMessage({
      endsAtTime: earlier.bounds.endTime,
      earliestStartTime,
      gapMinutes,
      isCandidate: earlier.isCandidate,
    });

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
