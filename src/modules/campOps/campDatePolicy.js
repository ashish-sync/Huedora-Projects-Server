import { AppError } from '../../utils/helpers.js';
import { parseLocalDateInput } from './campOps.helpers.js';

/** Dates more than this many days before today require Team Leader (or Admin). */
export const CAMP_HISTORICAL_DATE_THRESHOLD_DAYS = 2;

export function normalizeDesignationKey(designation) {
  return String(designation || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isTeamLeaderDesignation(designation) {
  return normalizeDesignationKey(designation) === 'team leader';
}

function localDateFromIso(value) {
  const raw = parseLocalDateInput(value) || String(value || '').slice(0, 10);
  if (!raw) return null;
  const [year, month, day] = raw.split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function daysFromToday(dateValue) {
  const target = localDateFromIso(dateValue);
  if (!target) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

/** Camp / request date is more than 2 days before today. */
export function isHistoricalCampDate(dateValue) {
  return daysFromToday(dateValue) < -CAMP_HISTORICAL_DATE_THRESHOLD_DAYS;
}

export function canSetHistoricalCampDates(user) {
  if (!user) return false;
  return isTeamLeaderDesignation(user.designation);
}

function normalizeDateKey(value) {
  return parseLocalDateInput(value) || String(value || '').slice(0, 10);
}

export function getHistoricalCampDateErrors(
  { campDate, requestDate } = {},
  { canSetHistorical = false, existing = null } = {},
) {
  if (canSetHistorical) return [];

  const errors = [];
  const checks = [
    ['campDate', 'Camp date', campDate],
    ['requestDate', 'Request date', requestDate],
  ];

  for (const [key, label, value] of checks) {
    if (!value) continue;
    const normalized = normalizeDateKey(value);
    if (!normalized || !isHistoricalCampDate(normalized)) continue;

    const existingNormalized = existing ? normalizeDateKey(existing[key]) : '';
    if (existing && normalized === existingNormalized) continue;

    errors.push(
      `${label} is more than ${CAMP_HISTORICAL_DATE_THRESHOLD_DAYS} days before today `
        + 'and can only be set by Team Leaders',
    );
  }

  return errors;
}

export function assertHistoricalCampDatesAllowed(user, _permissions, dates, { existing = null } = {}) {
  const errors = getHistoricalCampDateErrors(dates, {
    canSetHistorical: canSetHistoricalCampDates(user),
    existing,
  });
  if (errors.length) {
    throw new AppError(errors[0], 403, 'FORBIDDEN');
  }
}

export function minAllowedCampDateIso() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - CAMP_HISTORICAL_DATE_THRESHOLD_DAYS);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
