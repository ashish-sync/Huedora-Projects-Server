import { AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { userHasAnyPermission } from '../../middleware/auth.js';
import { normalizeEntityId } from '../../utils/entityIds.js';
import { CampOpsClientMaster } from './campOps.model.js';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeClientId(value) {
  return normalizeEntityId(value) || String(value || '').trim().toLowerCase();
}

export function parseAssignedUserEmails(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map(normalizeEmail).filter(Boolean))];
  }
  return [...new Set(String(raw || '')
    .split(/[;,\n]/)
    .map(normalizeEmail)
    .filter(Boolean))];
}

/**
 * Returns null when client-scoped RBAC is not configured or user is unrestricted.
 * Returns a Set of allowed clientIds when the user is listed on any Client Master
 * "Assigned User Login Emails" field.
 *
 * Policy when any master has assignments configured:
 * - User listed on one or more masters → only those clientIds (even if they have approve).
 * - User not listed + Admin (`*`) or camps:approve → unrestricted (internal ops).
 * - User not listed + no approve → empty set (sees nothing).
 */
export async function resolveCampClientScope(user = {}) {
  const email = normalizeEmail(user.email);
  if (!email) return null;

  const masters = await CampOpsClientMaster.find({ isDeleted: false });
  let anyAssignmentsConfigured = false;
  const scopedClientIds = new Set();

  for (const master of masters) {
    const emails = parseAssignedUserEmails(master.assignedUserEmails);
    if (!emails.length) continue;
    anyAssignmentsConfigured = true;
    if (emails.includes(email) && master.clientId) {
      scopedClientIds.add(normalizeClientId(master.clientId));
    }
  }

  if (!anyAssignmentsConfigured) return null;
  if (scopedClientIds.size === 0) {
    // Internal ops (admin or camp approvers) keep full visibility when not explicitly assigned.
    if (userHasAnyPermission(user, PERMISSIONS.ALL, PERMISSIONS.CAMPS_APPROVE)) return null;
    return new Set();
  }
  return scopedClientIds;
}

function scopeIdField(filter, scopedClientIds, field) {
  if (!scopedClientIds) return filter;
  if (scopedClientIds.size === 0) {
    return { ...filter, [field]: '__none__' };
  }
  const ids = [...scopedClientIds];
  const current = filter[field];
  if (current && typeof current === 'object' && Array.isArray(current.$in)) {
    const allowed = current.$in.map(normalizeClientId).filter((id) => ids.includes(id));
    return { ...filter, [field]: allowed.length ? { $in: allowed } : '__none__' };
  }
  if (current != null && current !== '') {
    const normalized = normalizeClientId(current);
    if (!ids.includes(normalized)) {
      return { ...filter, [field]: '__none__' };
    }
    return filter;
  }
  return { ...filter, [field]: { $in: ids } };
}

/** Restrict camp queries to the user's assigned clientIds. */
export function applyClientScopeToFilter(filter, scopedClientIds) {
  return scopeIdField(filter, scopedClientIds, 'clientId');
}

/** Restrict Client Master / brand queries (`clientId` or `_id`). */
export function applyClientScopeToIdField(filter, scopedClientIds, field = '_id') {
  return scopeIdField(filter, scopedClientIds, field);
}

export async function assertCampClientAccess(user, camp) {
  const scoped = await resolveCampClientScope(user);
  if (!scoped) return;
  if (!camp?.clientId || !scoped.has(normalizeClientId(camp.clientId))) {
    throw new AppError('You do not have access to this camp', 403, 'FORBIDDEN');
  }
}

export async function assertClientIdAccess(user, clientId) {
  await assertCampClientAccess(user, { clientId });
}

export function isClientIdInScope(scopedClientIds, clientId) {
  if (!scopedClientIds) return true;
  if (!clientId) return false;
  return scopedClientIds.has(normalizeClientId(clientId));
}
