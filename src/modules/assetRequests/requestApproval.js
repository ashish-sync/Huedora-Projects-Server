/**
 * Request One approval matrix (designation / role name).
 * Repair & Service: either Operations Leader OR Training Manager — one approval completes.
 */

import { AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';

export const DESIGNATION_OPERATIONS_LEADER = 'Operations Leader';
export const DESIGNATION_TRAINING_MANAGER = 'Training Manager';

/** Canonical keys used in matching (lowercase, collapsed spaces). */
export const APPROVER_KEYS = Object.freeze({
  OPERATIONS_LEADER: 'operations leader',
  TRAINING_MANAGER: 'training manager',
});

/**
 * Accept common synonyms so existing titles still match the matrix.
 * "Operations Leader" is the product name; Head/Manager map as the ops side.
 */
const OPERATIONS_LEADER_ALIASES = new Set([
  'operations leader',
  'operations head',
  'operations manager',
]);

const TRAINING_MANAGER_ALIASES = new Set([
  'training manager',
  'training head',
]);

export function normalizeApproverKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isOperationsLeaderKey(key) {
  return OPERATIONS_LEADER_ALIASES.has(normalizeApproverKey(key));
}

export function isTrainingManagerKey(key) {
  return TRAINING_MANAGER_ALIASES.has(normalizeApproverKey(key));
}

/**
 * Required approver keys for a request type.
 * Empty array → fall back to permission-based approve (legacy types).
 * @returns {string[]} e.g. ['operations leader'] or ['operations leader','training manager']
 */
export function requiredApproverKeysForType(requestType) {
  const t = String(requestType || '').trim().toUpperCase();
  switch (t) {
    case 'REPAIR':
    case 'MAINTENANCE':
      // Repair & Service — either may approve (OR)
      return [APPROVER_KEYS.OPERATIONS_LEADER, APPROVER_KEYS.TRAINING_MANAGER];
    case 'LOGISTICS':
    case 'MOVEMENT':
      return [APPROVER_KEYS.OPERATIONS_LEADER];
    case 'TRAINING':
      return [APPROVER_KEYS.TRAINING_MANAGER];
    case 'HIRING':
      return [APPROVER_KEYS.OPERATIONS_LEADER];
    default:
      return [];
  }
}

export function approvalRuleLabel(requestType) {
  const t = String(requestType || '').trim().toUpperCase();
  switch (t) {
    case 'REPAIR':
    case 'MAINTENANCE':
      return 'Operations Leader or Training Manager';
    case 'LOGISTICS':
    case 'MOVEMENT':
    case 'HIRING':
      return 'Operations Leader';
    case 'TRAINING':
      return 'Training Manager';
    default:
      return 'an authorized approver';
  }
}

/** Collect designation + role names from a user-like object. */
export function userApproverKeys(user) {
  const keys = new Set();
  const designation = normalizeApproverKey(user?.designation);
  if (designation) keys.add(designation);

  const roles = user?.roleIds || user?.roles || [];
  for (const role of roles) {
    const name = normalizeApproverKey(role?.name || role);
    if (name) keys.add(name);
  }
  return keys;
}

export function userMatchesApproverKeys(user, requiredKeys) {
  if (!requiredKeys?.length) return true;
  const have = userApproverKeys(user);
  for (const key of requiredKeys) {
    const k = normalizeApproverKey(key);
    if (k === APPROVER_KEYS.OPERATIONS_LEADER) {
      for (const h of have) {
        if (isOperationsLeaderKey(h)) return true;
      }
    } else if (k === APPROVER_KEYS.TRAINING_MANAGER) {
      for (const h of have) {
        if (isTrainingManagerKey(h)) return true;
      }
    } else if (have.has(k)) {
      return true;
    }
  }
  return false;
}

export function isAdminPermissions(permissions) {
  const perms = permissions instanceof Set ? permissions : new Set(permissions || []);
  return perms.has(PERMISSIONS.ALL) || perms.has('*');
}

/**
 * Whether this user may approve/reject/fulfill this request type.
 * Matrix types: designation/role OR Admin.
 * Other types: asset-requests:approve / movements:approve OR Admin.
 */
export function canApproveRequestType(user, permissions, requestType) {
  if (isAdminPermissions(permissions)) return true;
  const required = requiredApproverKeysForType(requestType);
  if (required.length) {
    return userMatchesApproverKeys(user, required);
  }
  const perms = permissions instanceof Set ? permissions : new Set(permissions || []);
  return (
    perms.has(PERMISSIONS.ASSET_REQUESTS_APPROVE) ||
    perms.has(PERMISSIONS.MOVEMENTS_APPROVE)
  );
}

export function assertCanApproveRequestType(user, permissions, requestType, action = 'approve') {
  if (canApproveRequestType(user, permissions, requestType)) return;
  throw new AppError(
    `Only ${approvalRuleLabel(requestType)} can ${action} this request`,
    403,
    'FORBIDDEN',
  );
}

/** Filter users who should receive approval notifications for this request. */
export function filterApproverUsers(users, requestType, { excludeUserId = null } = {}) {
  const required = requiredApproverKeysForType(requestType);
  return (users || []).filter((u) => {
    if (excludeUserId && String(u._id) === String(excludeUserId)) return false;
    if (!u || u.isDeleted || u.isActive === false) return false;
    if (required.length) {
      return userMatchesApproverKeys(u, required);
    }
    // Legacy types: anyone with Approver-ish role permissions
    const roleIds = u.roleIds || [];
    return roleIds.some((role) => {
      const perms = role?.permissions || [];
      const name = role?.name || '';
      return (
        perms.includes(PERMISSIONS.ASSET_REQUESTS_APPROVE) ||
        perms.includes(PERMISSIONS.MOVEMENTS_APPROVE) ||
        perms.includes(PERMISSIONS.ALL) ||
        perms.includes('*') ||
        name === 'Approver' ||
        name === 'Admin'
      );
    });
  });
}
