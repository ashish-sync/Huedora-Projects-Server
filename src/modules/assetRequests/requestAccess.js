/**
 * Request One type-scoped access (Access Control).
 *
 * Visibility (any ONE is enough):
 *  - Super Admin / *
 *  - Request creator (requestorId)
 *  - Creator's current Reporting Manager
 *  - Department processors with asset-requests:<type>:manage for that type only
 *
 * Critical rule: access to one request type never grants another.
 * Identity, reporting hierarchy, and departmental process rights are independent.
 */

import { PERMISSIONS } from '../../config/constants.js';
import { User } from '../users/user.model.js';
import { userIsSuperAdmin } from '../users/systemRole.js';

export const TYPE_MANAGE_PERMISSION = Object.freeze({
  REPAIR: PERMISSIONS.ASSET_REQUESTS_SERVICE_MANAGE,
  MAINTENANCE: PERMISSIONS.ASSET_REQUESTS_SERVICE_MANAGE,
  LOGISTICS: PERMISSIONS.ASSET_REQUESTS_LOGISTICS_MANAGE,
  MOVEMENT: PERMISSIONS.ASSET_REQUESTS_LOGISTICS_MANAGE,
  TRAINING: PERMISSIONS.ASSET_REQUESTS_TRAINING_MANAGE,
  REIMBURSEMENT: PERMISSIONS.ASSET_REQUESTS_FINANCE_MANAGE,
  HIRING: PERMISSIONS.ASSET_REQUESTS_HIRING_MANAGE,
  OTHER: PERMISSIONS.ASSET_REQUESTS_OTHER_MANAGE,
  /** Master One: Super Admin / * only — no grantable manage key */
  MASTER_ADD: null,
});

export const ALL_TYPE_MANAGE_PERMISSIONS = Object.freeze([
  PERMISSIONS.ASSET_REQUESTS_SERVICE_MANAGE,
  PERMISSIONS.ASSET_REQUESTS_LOGISTICS_MANAGE,
  PERMISSIONS.ASSET_REQUESTS_TRAINING_MANAGE,
  PERMISSIONS.ASSET_REQUESTS_FINANCE_MANAGE,
  PERMISSIONS.ASSET_REQUESTS_HIRING_MANAGE,
  PERMISSIONS.ASSET_REQUESTS_OTHER_MANAGE,
]);

/** Types unlocked by each manage permission (excludes MASTER_ADD). */
export const TYPES_FOR_MANAGE_PERMISSION = Object.freeze({
  [PERMISSIONS.ASSET_REQUESTS_SERVICE_MANAGE]: ['REPAIR', 'MAINTENANCE'],
  [PERMISSIONS.ASSET_REQUESTS_LOGISTICS_MANAGE]: ['LOGISTICS', 'MOVEMENT'],
  [PERMISSIONS.ASSET_REQUESTS_TRAINING_MANAGE]: ['TRAINING'],
  [PERMISSIONS.ASSET_REQUESTS_FINANCE_MANAGE]: ['REIMBURSEMENT'],
  [PERMISSIONS.ASSET_REQUESTS_HIRING_MANAGE]: ['HIRING'],
  [PERMISSIONS.ASSET_REQUESTS_OTHER_MANAGE]: ['OTHER'],
});

export function toPermissionSet(permissions) {
  if (permissions instanceof Set) return permissions;
  if (Array.isArray(permissions)) return new Set(permissions);
  return new Set();
}

export function normalizeRequestTypeKey(requestType) {
  return String(requestType || '')
    .trim()
    .toUpperCase();
}

export function managePermissionForType(requestType) {
  const t = normalizeRequestTypeKey(requestType);
  if (!t) return null;
  if (Object.prototype.hasOwnProperty.call(TYPE_MANAGE_PERMISSION, t)) {
    return TYPE_MANAGE_PERMISSION[t];
  }
  return null;
}

export function actorUserId(user) {
  return user?._id || user?.id || null;
}

export function isRequestAdmin(user, permissions) {
  const perms = toPermissionSet(permissions);
  return perms.has(PERMISSIONS.ALL) || perms.has('*') || userIsSuperAdmin(user);
}

export function isRequestOwner(user, row) {
  const userId = actorUserId(user);
  if (!userId || !row) return false;
  return String(row.requestorId?._id || row.requestorId) === String(userId);
}

/** Direct Reporting Manager of the requestor (populated reportingManagerId or flat id). */
export function isDirectManagerOfRequestor(user, row) {
  const userId = actorUserId(user);
  if (!userId || !row) return false;
  const requestor = row.requestorId;
  if (!requestor || typeof requestor !== 'object') return false;
  const managerId = requestor.reportingManagerId
    ? String(requestor.reportingManagerId._id || requestor.reportingManagerId)
    : '';
  return Boolean(managerId && managerId === String(userId));
}

/**
 * Department process right for this type only.
 * MASTER_ADD: admin only. Never cross-grants other types.
 */
export function canProcessRequestType(user, permissions, requestType) {
  if (isRequestAdmin(user, permissions)) return true;
  const t = normalizeRequestTypeKey(requestType);
  if (!t || t === 'MASTER_ADD') return false;
  const key = managePermissionForType(t);
  if (!key) return false;
  return toPermissionSet(permissions).has(key);
}

export function canProcessRequest(user, permissions, row) {
  return canProcessRequestType(user, permissions, row?.requestType);
}

/**
 * View: Super Admin | creator | creator's RM | type processor.
 * Recruiter cannot see Finance; Accounts cannot see Hiring.
 */
export function canViewRequest(user, permissions, row) {
  if (isRequestAdmin(user, permissions)) return true;
  if (isRequestOwner(user, row)) return true;
  if (isDirectManagerOfRequestor(user, row)) return true;
  return canProcessRequestType(user, permissions, row?.requestType);
}

export function canCancelRequest(user, permissions, row) {
  if (isRequestAdmin(user, permissions)) return true;
  if (isRequestOwner(user, row)) return true;
  return canProcessRequestType(user, permissions, row?.requestType);
}

/** Owner or type processor may mutate JD / bills / attachments. RM is view-only. */
export function canMutateRequestAttachments(user, permissions, row) {
  if (isRequestAdmin(user, permissions)) return true;
  if (isRequestOwner(user, row)) return true;
  return canProcessRequestType(user, permissions, row?.requestType);
}

export function cancelRequiresRemark(user, row) {
  return isRequestOwner(user, row);
}

/** @returns {string[]|null} managed types, or null when actor sees all types */
export function managedRequestTypes(user, permissions) {
  if (isRequestAdmin(user, permissions)) return null;
  const perms = toPermissionSet(permissions);
  const types = new Set();
  for (const key of ALL_TYPE_MANAGE_PERMISSIONS) {
    if (!perms.has(key)) continue;
    for (const t of TYPES_FOR_MANAGE_PERMISSION[key] || []) types.add(t);
  }
  return [...types];
}

export async function resolveDirectReportIds(managerId) {
  const id = String(managerId || '').trim();
  if (!id) return [];
  const rows = await User.find({
    reportingManagerId: id,
    isDeleted: false,
  }).select('_id');
  return rows.map((row) => row._id);
}

/**
 * List/export scope: own requests ∪ direct reports' requests ∪ managed types.
 * null = unscoped (admin).
 */
export async function listFilterForActor(user, permissions, { reportIds } = {}) {
  if (isRequestAdmin(user, permissions)) return null;
  const userId = actorUserId(user);
  if (!userId) return { requestorId: null };

  const managed = managedRequestTypes(user, permissions) || [];
  const reports =
    reportIds !== undefined ? reportIds : await resolveDirectReportIds(userId);

  const or = [{ requestorId: userId }];
  if (reports?.length) {
    or.push({ requestorId: { $in: reports } });
  }
  if (managed.length) {
    or.push({ requestType: { $in: managed } });
  }
  return { $or: or };
}

export async function applyActorListScope(filter, user, permissions, options) {
  const scope = await listFilterForActor(user, permissions, options);
  if (!scope) return filter;
  filter.$and = [...(filter.$and || []), scope];
  return filter;
}
