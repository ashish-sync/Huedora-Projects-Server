import { AppError } from '../../utils/helpers.js';
import { parseLocalDateInput } from './campOps.helpers.js';

/** Dates more than this many days before today need Reporting Manager approval. */
export const CAMP_HISTORICAL_DATE_THRESHOLD_DAYS = 2;

/** Same 2-day window used by historical-date and RM-approval checks. */
export const CAMP_T2_WINDOW_DAYS = CAMP_HISTORICAL_DATE_THRESHOLD_DAYS;

export const FUTURE_REQUEST_DATE_ERROR = 'Request date cannot be in the future';
export const REQUEST_DATE_APPROVAL_REASON = 'request_date_historical';
export const CAMP_DATE_APPROVAL_REASON = 'camp_date_historical';

const ADMIN_DESIGNATION_KEYS = new Set(['admin', 'administrator']);
const ADMIN_ROLE_KEYS = new Set(['admin', 'administrator']);

export function normalizeDesignationKey(designation) {
  return String(designation || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isTeamLeaderDesignation(designation) {
  return normalizeDesignationKey(designation) === 'team leader';
}

export function isAdminDesignation(designation) {
  return ADMIN_DESIGNATION_KEYS.has(normalizeDesignationKey(designation));
}

function userRoleNames(user) {
  const names = [];
  if (user?.role) names.push(String(user.role));
  if (user?.roleName) names.push(String(user.roleName));
  if (Array.isArray(user?.roles)) {
    for (const role of user.roles) {
      if (typeof role === 'string') names.push(role);
      else if (role?.name) names.push(String(role.name));
    }
  }
  return names.map((name) => normalizeDesignationKey(name)).filter(Boolean);
}

export function isAdminUser(user, permissions = null) {
  if (!user) return false;
  if (isAdminDesignation(user.designation)) return true;
  if (userRoleNames(user).some((name) => ADMIN_ROLE_KEYS.has(name))) return true;
  if (permissions?.has?.('*')) return true;
  if (user.permissions instanceof Set && user.permissions.has('*')) return true;
  if (Array.isArray(user.permissions) && user.permissions.includes('*')) return true;
  return false;
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

export function daysFromToday(dateValue, now = new Date()) {
  const target = localDateFromIso(dateValue);
  if (!target) return 0;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

/** Camp / request date is more than 2 days before today. */
export function isHistoricalCampDate(dateValue, now = new Date()) {
  return daysFromToday(dateValue, now) < -CAMP_HISTORICAL_DATE_THRESHOLD_DAYS;
}

/** Request date is yesterday or the day before (T-1 / T-2), not today. */
export function isT2RequestDate(dateValue, now = new Date()) {
  const days = daysFromToday(dateValue, now);
  return days < 0 && days >= -CAMP_T2_WINDOW_DAYS;
}

/** Scheduled camp date is today through two days ahead. */
export function isT2UpcomingCampDate(dateValue, now = new Date()) {
  const days = daysFromToday(dateValue, now);
  return days >= 0 && days <= CAMP_T2_WINDOW_DAYS;
}

export function isFutureRequestDate(dateValue, now = new Date()) {
  if (!dateValue) return false;
  return daysFromToday(dateValue, now) > 0;
}

export function getFutureRequestDateError(dateValue, now = new Date()) {
  return isFutureRequestDate(dateValue, now) ? FUTURE_REQUEST_DATE_ERROR : '';
}

/**
 * Reasons a camp create needs Reporting Manager approval.
 * Request date and camp date earlier than today minus 2 days.
 */
export function campCreateApprovalReasons(
  { campDate, requestDate } = {},
  now = new Date(),
) {
  const reasons = [];
  if (isHistoricalCampDate(requestDate, now)) {
    reasons.push(REQUEST_DATE_APPROVAL_REASON);
  }
  if (isHistoricalCampDate(campDate, now)) {
    reasons.push(CAMP_DATE_APPROVAL_REASON);
  }
  return reasons;
}

export function assertRequestDateNotFuture(requestDate, now = new Date()) {
  const error = getFutureRequestDateError(requestDate, now);
  if (error) {
    throw new AppError(error, 400, 'VALIDATION_ERROR');
  }
}

export function canSetHistoricalCampDates(user, permissions = null) {
  if (!user) return false;
  return isTeamLeaderDesignation(user.designation) || isAdminUser(user, permissions);
}

export function getHistoricalCampDateErrors() {
  return [];
}

export function assertHistoricalCampDatesAllowed() {
  // Anyone may enter dates earlier than today minus 2 days; RM approval is the gate.
}

export function localTodayIso(now = new Date()) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
