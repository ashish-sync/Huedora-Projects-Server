import { AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { userHasAnyPermission } from '../../middleware/auth.js';
import { CampOpsClientMaster } from './campOps.model.js';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
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
 * Returns a Set of allowed clientIds when the user is listed on any client master.
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
      scopedClientIds.add(String(master.clientId));
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

export function applyClientScopeToFilter(filter, scopedClientIds) {
  if (!scopedClientIds) return filter;
  if (scopedClientIds.size === 0) {
    return { ...filter, clientId: '__none__' };
  }
  const ids = [...scopedClientIds];
  if (filter.clientId && !ids.includes(String(filter.clientId))) {
    return { ...filter, clientId: '__none__' };
  }
  if (!filter.clientId) {
    return { ...filter, clientId: { $in: ids } };
  }
  return filter;
}

export async function assertCampClientAccess(user, camp) {
  const scoped = await resolveCampClientScope(user);
  if (!scoped) return;
  if (!camp?.clientId || !scoped.has(String(camp.clientId))) {
    throw new AppError('You do not have access to this camp', 403, 'FORBIDDEN');
  }
}
