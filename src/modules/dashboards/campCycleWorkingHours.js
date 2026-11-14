/**
 * Avg. Camp Cycle working-hours clock:
 * Camp end (Out Time, else scheduled End Time) → Confirm Payment.
 * Window: 10:00 AM–7:00 PM IST, Monday–Saturday (Sunday excluded).
 */
import { parseTimeToMinutes } from '../campOps/campOps.helpers.js';
import { IST_TIME_ZONE } from '../campOps/istTime.js';

export const CAMP_CYCLE_WORK_START_HOUR = 10;
export const CAMP_CYCLE_WORK_END_HOUR = 19;
export const CAMP_CYCLE_GOOD_MAX_HOURS = 16;
export const CAMP_CYCLE_AVERAGE_MAX_HOURS = 32;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const DAY_PARTS_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
});

/** Instant for an IST wall-clock on a calendar day. */
export function istWallClockToUtcMs(year, month, day, hour = 0, minute = 0) {
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0) - IST_OFFSET_MS;
}

function istCalendarParts(ms) {
  const values = Object.fromEntries(
    DAY_PARTS_FORMATTER.formatToParts(new Date(ms))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: values.weekday,
  };
}

function isIstWorkingDay(weekday) {
  // en-GB short weekday in Asia/Kolkata — Sunday off, Sat on.
  return weekday !== 'Sun';
}

function workWindowUtcMs(year, month, day, weekday) {
  if (!isIstWorkingDay(weekday)) return null;
  return {
    start: istWallClockToUtcMs(year, month, day, CAMP_CYCLE_WORK_START_HOUR, 0),
    end: istWallClockToUtcMs(year, month, day, CAMP_CYCLE_WORK_END_HOUR, 0),
  };
}

/**
 * Elapsed milliseconds between two instants counting only
 * Mon–Sat 10:00–19:00 Asia/Kolkata.
 */
export function elapsedCampCycleWorkingMs(start, end) {
  const t0 = new Date(start).getTime();
  const t1 = new Date(end).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return 0;

  let total = 0;
  const startParts = istCalendarParts(t0);
  let y = startParts.year;
  let m = startParts.month;
  let d = startParts.day;

  for (let i = 0; i < 400; i += 1) {
    const noonUtc = istWallClockToUtcMs(y, m, d, 12, 0);
    const { weekday } = istCalendarParts(noonUtc);
    const window = workWindowUtcMs(y, m, d, weekday);
    if (window) {
      const segStart = Math.max(t0, window.start);
      const segEnd = Math.min(t1, window.end);
      if (segEnd > segStart) total += segEnd - segStart;
    }
    if (istWallClockToUtcMs(y, m, d, 23, 59) >= t1) break;
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }
  return total;
}

export function elapsedCampCycleWorkingHours(start, end) {
  return elapsedCampCycleWorkingMs(start, end) / (60 * 60 * 1000);
}

/** Camp end instant: campDate + Out Time, else scheduled End Time (IST). */
export function resolveCampEndInstant(camp = {}) {
  const date = String(camp.campDate || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timeRaw = String(camp.outTime || camp.endTime || '').trim();
  const minutes = parseTimeToMinutes(timeRaw);
  if (minutes == null) return null;
  const [y, m, d] = date.split('-').map(Number);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return new Date(istWallClockToUtcMs(y, m, d, hour, minute));
}

export function resolvePaymentConfirmedInstant(camp = {}) {
  const raw = camp.paymentConfirmedAt;
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * Rate cycle from camp end → Confirm Payment.
 * @returns {'Pending'|'Cancelled'|'Good'|'Average'|'Poor'}
 */
export function classifyCampCycleFromWorkingHours(camp = {}, { cancelled = false } = {}) {
  if (cancelled) return 'Cancelled';
  const confirmedAt = resolvePaymentConfirmedInstant(camp);
  if (!confirmedAt) return 'Pending';
  const campEnd = resolveCampEndInstant(camp);
  if (!campEnd) return 'Pending';

  const hours = elapsedCampCycleWorkingHours(campEnd, confirmedAt);
  if (hours <= CAMP_CYCLE_GOOD_MAX_HOURS) return 'Good';
  if (hours <= CAMP_CYCLE_AVERAGE_MAX_HOURS) return 'Average';
  return 'Poor';
}
