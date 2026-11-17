/**
 * Public Camp Request — Minimum Advance Booking Validation
 *
 * - Working days: Monday–Saturday
 * - Working hours: 10:00–19:00 Asia/Kolkata (IST)
 * - Sundays and hours outside the window are excluded
 * - Require ≥ 18 working hours between request datetime and camp start
 */

import { AppError } from '../../utils/helpers.js';
import { parseLocalDateInput } from './campOps.helpers.js';

export const ADVANCE_BOOKING_TIME_ZONE = 'Asia/Kolkata';
/** India has no DST — fixed IST offset. */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const ADVANCE_BOOKING_WORK_START_HOUR = 10;
export const ADVANCE_BOOKING_WORK_END_HOUR = 19;
export const ADVANCE_BOOKING_WORKING_HOURS = 18;
export const ADVANCE_BOOKING_WORKING_MS = ADVANCE_BOOKING_WORKING_HOURS * 60 * 60 * 1000;

export const REQUEST_ACCEPTANCE_WINDOW_ERROR =
  'Camp requests are accepted Monday–Saturday, 10 AM–7 PM (IST) only.';

export const ADVANCE_BOOKING_LEAD_TIME_ERROR =
  'Camp must be booked at least 18 working hours in advance (Mon–Sat, 10 AM–7 PM IST; Sundays excluded).';

export function formatAdvanceBookingWorkingHours(ms) {
  const totalMinutes = Math.max(0, Math.floor(Number(ms) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours} working hour${hours === 1 ? '' : 's'}`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m working time`;
}

/**
 * Eligibility summary between request datetime and camp start (IST working hours).
 * Submissions are allowed any day/time — only the lead-time gap is gated.
 */
export function getAdvanceBookingEligibility(
  { campDate, startTime, requestDate, requestTime } = {},
  now = new Date(),
) {
  const requestAt = parseRequestDateTime(requestDate, requestTime, now);
  const campStart = parseCampStartDateTime(campDate, startTime);
  if (!campStart) {
    return {
      ok: false,
      ready: false,
      workingMs: 0,
      requiredMs: ADVANCE_BOOKING_WORKING_MS,
      workingHoursLabel: formatAdvanceBookingWorkingHours(0),
      requiredHoursLabel: formatAdvanceBookingWorkingHours(ADVANCE_BOOKING_WORKING_MS),
      message: 'Select camp date and start time to check advance notice.',
    };
  }
  const workingMs = elapsedAdvanceBookingWorkingMs(requestAt, campStart);
  const ok = workingMs >= ADVANCE_BOOKING_WORKING_MS;
  const workingHoursLabel = formatAdvanceBookingWorkingHours(workingMs);
  const requiredHoursLabel = formatAdvanceBookingWorkingHours(ADVANCE_BOOKING_WORKING_MS);
  return {
    ok,
    ready: true,
    workingMs,
    requiredMs: ADVANCE_BOOKING_WORKING_MS,
    workingHoursLabel,
    requiredHoursLabel,
    message: ok
      ? `Advance notice met: ${workingHoursLabel} available (minimum ${requiredHoursLabel}).`
      : `Insufficient advance notice: ${workingHoursLabel} available; minimum ${requiredHoursLabel} required (Mon–Sat, 10 AM–7 PM IST; Sundays excluded).`,
  };
}

function normalizeTimeOfDay(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hh = Math.min(23, Number(match[1]));
  const mm = Math.min(59, Number(match[2]));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return '';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** IST wall-clock components for an absolute instant. */
export function istParts(date = new Date()) {
  const istMs = new Date(date).getTime() + IST_OFFSET_MS;
  const d = new Date(istMs);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    dayOfWeek: d.getUTCDay(),
  };
}

/** Absolute UTC ms for an IST wall-clock date/time. */
export function istWallToUtcMs({ year, month, day, hour = 0, minute = 0, second = 0 } = {}) {
  return Date.UTC(year, month, day, hour, minute, second, 0) - IST_OFFSET_MS;
}

export function istTodayIso(now = new Date()) {
  const p = istParts(now);
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addIstCalendarDays(isoDate, days) {
  const raw = String(isoDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const [y, m, d] = raw.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000;
  const next = new Date(utc);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Interpret camp date + start time as IST wall clock → Date (UTC instant).
 */
export function parseCampStartDateTime(campDate, startTime) {
  const dateIso = parseLocalDateInput(campDate) || String(campDate || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  const time = normalizeTimeOfDay(startTime);
  if (!time) return null;
  const [year, month, day] = dateIso.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(istWallToUtcMs({
    year,
    month: month - 1,
    day,
    hour: hh,
    minute: mm,
  }));
}

/**
 * Interpret request date (YYYY-MM-DD) + optional time as IST.
 * When time is omitted, uses current IST clock time on that date if date is today,
 * otherwise end of that IST calendar day working window is not assumed — use noon.
 * For public submit, prefer passing `now` directly via getAdvanceBookingErrors.
 */
export function parseRequestDateTime(requestDate, requestTime, now = new Date()) {
  const dateIso = String(requestDate || '').trim().slice(0, 10);
  const time = normalizeTimeOfDay(requestTime);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateIso) && time) {
    const [year, month, day] = dateIso.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    return new Date(istWallToUtcMs({
      year,
      month: month - 1,
      day,
      hour: hh,
      minute: mm,
    }));
  }
  return new Date(now);
}

function workWindowUtcMsForIstDay(year, month, day) {
  // Sunday = 0
  const dow = new Date(Date.UTC(year, month, day)).getUTCDay();
  if (dow === 0) return null;
  return {
    start: istWallToUtcMs({
      year,
      month,
      day,
      hour: ADVANCE_BOOKING_WORK_START_HOUR,
      minute: 0,
    }),
    end: istWallToUtcMs({
      year,
      month,
      day,
      hour: ADVANCE_BOOKING_WORK_END_HOUR,
      minute: 0,
    }),
  };
}

/** True when `now` falls in Mon–Sat, 10:00 inclusive through 19:00 exclusive (IST). */
export function isWithinRequestAcceptanceWindow(now = new Date()) {
  const p = istParts(now);
  if (p.dayOfWeek === 0) return false;
  const minutes = p.hour * 60 + p.minute;
  const start = ADVANCE_BOOKING_WORK_START_HOUR * 60;
  const end = ADVANCE_BOOKING_WORK_END_HOUR * 60;
  return minutes >= start && minutes < end;
}

/**
 * Working milliseconds between two absolute instants (Mon–Sat 10–19 IST only).
 */
export function elapsedAdvanceBookingWorkingMs(start, end) {
  const t0 = new Date(start).getTime();
  const t1 = new Date(end).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return 0;

  let total = 0;
  const startIst = istParts(new Date(t0));
  let year = startIst.year;
  let month = startIst.month;
  let day = startIst.day;

  // Walk IST calendar days until past end.
  for (let guard = 0; guard < 60; guard += 1) {
    const dayStartUtc = istWallToUtcMs({ year, month, day, hour: 0, minute: 0 });
    if (dayStartUtc >= t1) break;

    const window = workWindowUtcMsForIstDay(year, month, day);
    if (window) {
      const segStart = Math.max(t0, window.start);
      const segEnd = Math.min(t1, window.end);
      if (segEnd > segStart) total += segEnd - segStart;
    }

    // Next IST calendar day
    const next = new Date(Date.UTC(year, month, day + 1));
    year = next.getUTCFullYear();
    month = next.getUTCMonth();
    day = next.getUTCDate();
  }
  return total;
}

export function hasMinimumAdvanceBookingLeadTime(campStart, requestAt = new Date()) {
  if (!campStart) return false;
  return elapsedAdvanceBookingWorkingMs(requestAt, campStart) >= ADVANCE_BOOKING_WORKING_MS;
}

/**
 * Earliest camp date (IST YYYY-MM-DD) that can satisfy the 18 working-hour rule
 * for the given camp start time (defaults to 19:00 — latest same-day working bound
 * still may need later calendar days depending on request time).
 */
export function minCampDateIsoSatisfyingAdvanceBooking(now = new Date(), startTime = '10:00') {
  const time = normalizeTimeOfDay(startTime) || '10:00';
  let dateIso = istTodayIso(now);
  for (let i = 0; i < 21; i += 1) {
    const campStart = parseCampStartDateTime(dateIso, time);
    if (campStart && hasMinimumAdvanceBookingLeadTime(campStart, now)) {
      return dateIso;
    }
    dateIso = addIstCalendarDays(dateIso, 1);
  }
  return dateIso;
}

/**
 * Returns human-readable errors for the advance booking rule.
 * Empty array = eligible.
 *
 * Uses requestDate + requestTime when provided; otherwise `now`.
 */
export function getAdvanceBookingErrors(
  { campDate, startTime, requestDate, requestTime } = {},
  now = new Date(),
  { checkAcceptanceWindow = false } = {},
) {
  const errors = [];
  const requestAt = parseRequestDateTime(requestDate, requestTime, now);

  // Public Camp Request may be submitted any day/time. The acceptance-window
  // check is opt-in only (legacy); lead time always uses working-hour counting.
  if (checkAcceptanceWindow && !isWithinRequestAcceptanceWindow(requestAt)) {
    errors.push(REQUEST_ACCEPTANCE_WINDOW_ERROR);
  }

  const eligibility = getAdvanceBookingEligibility(
    { campDate, startTime, requestDate, requestTime },
    now,
  );
  if (!eligibility.ready) return errors;
  if (!eligibility.ok) {
    errors.push(eligibility.message || ADVANCE_BOOKING_LEAD_TIME_ERROR);
  }
  return errors;
}

export function assertAdvanceBookingAllowed(values = {}, now = new Date(), options = {}) {
  const errors = getAdvanceBookingErrors(values, now, {
    checkAcceptanceWindow: false,
    ...options,
  });
  if (errors.length) {
    throw new AppError(errors[0], 400, 'VALIDATION_ERROR');
  }
}
