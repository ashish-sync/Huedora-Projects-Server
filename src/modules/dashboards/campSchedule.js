import { CampOpsCamp } from '../campOps/campOps.model.js';
import { CAMP_SLOTS } from '../campOps/campOps.lifecycle.js';
import {
  resolveCampClientScope,
} from '../campOps/campOps.clientAccess.js';
import {
  applyAssignedUserAssignmentsToFilter,
} from '../campOps/clientMaster.programScope.js';
import {
  resolveOperationsBoardStage,
  resolveOperationsBoardStatus,
} from '../campOps/campOps.operationsBoard.js';

/** Camp One Camp Slot vocabulary (Morning / Noon / Evening). */
export const CAMP_SCHEDULE_SLOTS = [...CAMP_SLOTS];

const SLOT_ALIASES = {
  morning: 'Morning',
  noon: 'Noon',
  afternoon: 'Noon',
  evening: 'Evening',
};

/** Ops-board statuses counted on the homepage Camp Schedule. */
export const CAMP_SCHEDULE_INCLUDE_STATUSES = new Set([
  'unassigned',
  'hiring_requested',
  'planned',
  'executed',
]);

export function toLocalDateIso(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addLocalDaysIso(iso, days) {
  const [year, month, day] = String(iso || '')
    .slice(0, 10)
    .split('-')
    .map(Number);
  if (!year || !month || !day) return '';
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + Number(days || 0));
  return toLocalDateIso(date);
}

export function endOfMonthIso(iso) {
  const [year, month] = String(iso || '')
    .slice(0, 10)
    .split('-')
    .map(Number);
  if (!year || !month) return '';
  const date = new Date(year, month, 0);
  return toLocalDateIso(date);
}

export function normalizeCampDateIso(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toLocalDateIso(value);
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return toLocalDateIso(parsed);
  return '';
}

/** Use stored Camp Slot only — no startTime recalculation. */
export function resolveScheduleSlot(camp = {}) {
  const raw = String(camp.campSlot || '').trim();
  if (!raw) return '';
  if (CAMP_SCHEDULE_SLOTS.includes(raw)) return raw;
  return SLOT_ALIASES[raw.toLowerCase()] || '';
}

export function resolveCampIdentity(camp = {}) {
  const campId = String(camp.campId || '').trim();
  if (campId) return campId;
  if (camp._id != null) return String(camp._id);
  if (camp.id != null) return String(camp.id);
  return '';
}

/**
 * Eligibility reuses Camp One operations-board stage/status resolution.
 * Include: Unassigned, Hiring Requested, Planned, Executed.
 * Financial (non-hold) camps are treated as post-Executed where applicable.
 * Exclude: refused / cancelled / unapproved (request) / on-hold.
 */
export function isCampScheduleEligible(camp = {}, now = new Date()) {
  if (camp?.isDeleted) return false;

  const stage = resolveOperationsBoardStage(camp);
  const status = resolveOperationsBoardStatus(camp, stage, now);

  if (!status) return false;
  if (status === 'payment_hold') return false;
  if (status === 'request_rejected') return false;
  if (status === 'cancelled_by_tylo' || status === 'cancelled_by_client') return false;
  if (stage === 'request') return false;

  if (CAMP_SCHEDULE_INCLUDE_STATUSES.has(status)) return true;

  // Executed camps that advanced into Finance (not on hold) remain schedule-eligible.
  if (stage === 'financial') return true;

  return false;
}

export function emptySlotCounts() {
  return { today: 0, tomorrow: 0, dayAfter: 0, restOfMonth: 0 };
}

function emptySeenSets() {
  return Object.fromEntries(CAMP_SCHEDULE_SLOTS.map((slot) => [slot, new Set()]));
}

export function buildCampScheduleMatrix(camps = [], now = new Date()) {
  const today = toLocalDateIso(now);
  const tomorrow = addLocalDaysIso(today, 1);
  const dayAfter = addLocalDaysIso(today, 2);
  // EOM = Day 3 through last day of the current month (excludes Day 0–2).
  const restOfMonthFrom = addLocalDaysIso(today, 3);
  const restOfMonthTo = endOfMonthIso(today);

  const bySlot = Object.fromEntries(CAMP_SCHEDULE_SLOTS.map((slot) => [slot, emptySlotCounts()]));
  const seen = {
    today: emptySeenSets(),
    tomorrow: emptySeenSets(),
    dayAfter: emptySeenSets(),
    restOfMonth: emptySeenSets(),
  };

  const bump = (slot, bucket, identity) => {
    const bucketSeen = seen[bucket]?.[slot];
    if (!bucketSeen || bucketSeen.has(identity)) return;
    bucketSeen.add(identity);
    bySlot[slot][bucket] += 1;
  };

  for (const camp of camps) {
    if (!isCampScheduleEligible(camp, now)) continue;

    const date = normalizeCampDateIso(camp.campDate);
    const slot = resolveScheduleSlot(camp);
    const identity = resolveCampIdentity(camp);
    if (!date || !slot || !bySlot[slot] || !identity) continue;

    if (date === today) bump(slot, 'today', identity);
    if (date === tomorrow) bump(slot, 'tomorrow', identity);
    if (date === dayAfter) bump(slot, 'dayAfter', identity);
    if (
      restOfMonthTo
      && date >= restOfMonthFrom
      && date <= restOfMonthTo
    ) {
      bump(slot, 'restOfMonth', identity);
    }
  }

  const rows = CAMP_SCHEDULE_SLOTS.map((campSlot) => ({
    campSlot,
    ...bySlot[campSlot],
  }));

  const totals = rows.reduce(
    (acc, row) => ({
      today: acc.today + row.today,
      tomorrow: acc.tomorrow + row.tomorrow,
      dayAfter: acc.dayAfter + row.dayAfter,
      restOfMonth: acc.restOfMonth + row.restOfMonth,
    }),
    emptySlotCounts(),
  );

  return {
    asOfDate: today,
    dates: {
      today,
      tomorrow,
      dayAfter,
      restOfMonthFrom,
      restOfMonthTo,
    },
    slots: [...CAMP_SCHEDULE_SLOTS],
    rows,
    totals,
  };
}

const CAMP_SCHEDULE_SELECT = [
  'campId',
  'campDate',
  'campSlot',
  'status',
  'isDeleted',
  'lifecycleStage',
  'assignmentStatus',
  'assignmentDecision',
  'executionStatus',
  'effectiveExecutionStatus',
  'financePaymentStatus',
  'paymentSubmitStatus',
  'cancellationSource',
  'cancelledBy',
  'assignmentRefusalReason',
  'requestReviewStatus',
  'requestIncomplete',
  'submittedAt',
].join(' ');

export async function loadCampScheduleMatrix(now = new Date(), user = null) {
  const today = toLocalDateIso(now);
  const dayAfter = addLocalDaysIso(today, 2);
  const restOfMonthTo = endOfMonthIso(today);
  // Include Day 2 even when it spills past month-end; EOM stays within the month.
  const rangeEnd = dayAfter > restOfMonthTo ? dayAfter : restOfMonthTo;

  let filter = {
    isDeleted: { $ne: true },
    campDate: { $gte: today, $lte: rangeEnd },
  };
  const programScope = await resolveCampClientScope(user || {});
  if (programScope) {
    filter = applyAssignedUserAssignmentsToFilter(filter, programScope);
  }

  const camps = await CampOpsCamp.find(filter)
    .select(CAMP_SCHEDULE_SELECT)
    .lean();

  return buildCampScheduleMatrix(camps || [], now);
}
