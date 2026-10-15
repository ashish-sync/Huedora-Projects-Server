import { AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { normalizeFinancePaymentStatus } from '../campOps/campOps.lifecycle.js';

/** Email allowlist (Zohra — Operations Head; always permitted regardless of designation). */
export const CAMP_PAYOUT_RETURN_EMAILS = new Set([
  'zohra@tylocare.com',
]);

/** Role names that may return a camp from Payout Queue → Camp One Financial. */
export const CAMP_PAYOUT_RETURN_ROLE_NAMES = new Set([
  'admin',
  'accounts',
]);

/**
 * Designations that may return a camp from Payout Queue.
 * Normalized with lowercase + collapsed spaces + en/em dash → hyphen.
 */
export const CAMP_PAYOUT_RETURN_DESIGNATIONS = new Set([
  'accounts',
  'lead - technology & process implementation',
]);

export function normalizePayoutReturnKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ');
}

function collectRoleNames(user = {}) {
  const names = [];
  for (const role of user.roleIds || []) {
    const name = typeof role === 'object' ? role?.name : '';
    if (name) names.push(name);
  }
  for (const role of user.roles || []) {
    const name = typeof role === 'object' ? role?.name : role;
    if (name) names.push(name);
  }
  return names.map((name) => normalizePayoutReturnKey(name));
}

/**
 * Admin (*), Accounts role/designation, Lead – Technology & Process Implementation,
 * or Zohra (by email / name) may push a camp back from Payout Queue.
 */
export function canReturnCampFromPayoutQueue(user, permissions) {
  const perms = permissions instanceof Set ? permissions : new Set(permissions || []);
  if (perms.has(PERMISSIONS.ALL) || perms.has('*')) return true;

  const email = normalizePayoutReturnKey(user?.email);
  if (CAMP_PAYOUT_RETURN_EMAILS.has(email)) return true;

  const fullName = normalizePayoutReturnKey(user?.fullName);
  if (fullName.includes('zohra')) return true;

  const designation = normalizePayoutReturnKey(user?.designation);
  if (CAMP_PAYOUT_RETURN_DESIGNATIONS.has(designation)) return true;

  for (const roleName of collectRoleNames(user)) {
    if (CAMP_PAYOUT_RETURN_ROLE_NAMES.has(roleName)) return true;
  }

  return false;
}

export function assertCanReturnCampFromPayoutQueue(user, permissions) {
  if (canReturnCampFromPayoutQueue(user, permissions)) return;
  throw new AppError(
    'Only Admin, Accounts, Lead – Technology & Process Implementation, or Zohra can return a camp from Payout Queue',
    403,
    'FORBIDDEN',
  );
}

/**
 * Clear Finance One queue membership and restore Camp One Financial as if the
 * camp just arrived from Execution — Pending Confirmation — so revenue/payout
 * amounts can be edited and Confirm Payment run again before re-submit.
 * Payment Done camps cannot be returned.
 */
export function applyReturnCampFromPayoutQueue(camp) {
  if (!camp) {
    throw new AppError('Camp payout not found', 404);
  }
  if (!camp.submittedToFinanceAt) {
    throw new AppError('Camp is not in the Payout Queue', 400, 'VALIDATION_ERROR');
  }
  if (normalizeFinancePaymentStatus(camp.financePaymentStatus) === 'paid') {
    throw new AppError(
      'Payment Done camps cannot be returned to Camp One Financial',
      400,
      'INVALID_TRANSITION',
    );
  }

  camp.submittedToFinanceAt = null;
  camp.submittedToFinanceById = null;
  camp.submittedToFinanceByEmail = '';
  camp.financePaymentStatus = '';
  // Same state as Mark Complete → Financial (Pending Confirmation).
  camp.paymentSubmitStatus = 'payment_not_checked';
  camp.lifecycleStage = 'financial';
  return camp;
}
