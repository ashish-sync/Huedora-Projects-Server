import { AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { userHasAnyPermission } from '../../middleware/auth.js';
import { normalizeEntityId } from '../../utils/entityIds.js';
import { CampOpsClientMaster } from './campOps.model.js';
import {
  campMatchesProgramAssignment,
  clientIdsFromProgramAssignments,
  filterCampsByProgramAssignments,
  filterMastersByProgramAssignments,
  masterMatchesProgramScope,
} from './clientMaster.programScope.js';

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
 * Returns [] when the user has no matching assignments.
 * Returns assignment rows `{ clientId, programName, campName }` when listed on masters.
 *
 * Policy when any master has assignments configured:
 * - User listed on one or more masters → only those client + division + method combos.
 * - User not listed + Admin (`*`) → unrestricted (internal ops).
 * - User not listed + everyone else (including camps:approve) → empty scope (sees nothing).
 */
export async function resolveCampClientScope(user = {}) {
  const email = normalizeEmail(user.email);
  if (!email) return null;

  const masters = await CampOpsClientMaster.find({ isDeleted: false });
  let anyAssignmentsConfigured = false;
  const assignments = [];
  const seen = new Set();

  for (const master of masters) {
    const emails = parseAssignedUserEmails(master.assignedUserEmails);
    if (!emails.length) continue;
    anyAssignmentsConfigured = true;
    if (!emails.includes(email) || !master.clientId) continue;
    const programName = String(master.programName || master.drugTherapyName || '').trim();
    const campName = String(master.campName || '').trim();
    if (!programName || !campName) continue;
    const key = [
      normalizeClientId(master.clientId),
      programName.toLowerCase(),
      campName.toLowerCase(),
    ].join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    assignments.push({
      clientId: normalizeClientId(master.clientId),
      programName,
      campName,
    });
  }

  if (!anyAssignmentsConfigured) return null;
  if (!assignments.length) {
    if (userHasAnyPermission(user, PERMISSIONS.ALL)) return null;
    return [];
  }
  return assignments;
}

function scopeIdField(filter, scopedAssignments, field) {
  if (scopedAssignments === null || scopedAssignments === undefined) return filter;
  if (!Array.isArray(scopedAssignments) || scopedAssignments.length === 0) {
    return { ...filter, [field]: '__none__' };
  }
  const ids = clientIdsFromProgramAssignments(scopedAssignments);
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
  return { ...filter, [field]: ids.length === 1 ? ids[0] : { $in: ids } };
}

/** Restrict camp queries to assigned clientIds (program filter applied after fetch). */
export function applyClientScopeToFilter(filter, scopedAssignments) {
  return scopeIdField(filter, scopedAssignments, 'clientId');
}

/** Restrict Client Master queries by assigned clientIds (program filter applied after fetch). */
export function applyClientScopeToIdField(filter, scopedAssignments, field = '_id') {
  return scopeIdField(filter, scopedAssignments, field);
}

export function filterRowsByCampClientScope(rows, scopedAssignments, { camp = false, master = false } = {}) {
  if (scopedAssignments === null || scopedAssignments === undefined) return rows;
  if (!Array.isArray(scopedAssignments) || scopedAssignments.length === 0) return [];
  if (camp) return filterCampsByProgramAssignments(rows, scopedAssignments);
  if (master) return filterMastersByProgramAssignments(rows, scopedAssignments);
  return rows;
}

export async function assertCampClientAccess(user, camp) {
  const scoped = await resolveCampClientScope(user);
  if (!scoped) return;
  if (!Array.isArray(scoped) || !scoped.length) {
    throw new AppError('You do not have access to this camp', 403, 'FORBIDDEN');
  }
  if (!scoped.some((assignment) => campMatchesProgramAssignment(camp, assignment))) {
    throw new AppError('You do not have access to this camp', 403, 'FORBIDDEN');
  }
}

export async function assertClientIdAccess(user, clientId) {
  const scoped = await resolveCampClientScope(user);
  if (!scoped) return;
  if (!Array.isArray(scoped) || !scoped.length) {
    throw new AppError('You do not have access to this client', 403, 'FORBIDDEN');
  }
  const normalized = normalizeClientId(clientId);
  if (!scoped.some((assignment) => normalizeClientId(assignment.clientId) === normalized)) {
    throw new AppError('You do not have access to this client', 403, 'FORBIDDEN');
  }
}

export async function assertClientMasterAccess(user, master = {}) {
  const scoped = await resolveCampClientScope(user);
  if (!scoped) return;
  if (!isClientMasterInScope(scoped, master)) {
    throw new AppError('You do not have access to this program', 403, 'FORBIDDEN');
  }
}

export function isClientIdInScope(scopedAssignments, clientId) {
  if (scopedAssignments === null || scopedAssignments === undefined) return true;
  if (!Array.isArray(scopedAssignments) || !scopedAssignments.length) return false;
  if (!clientId) return false;
  const normalized = normalizeClientId(clientId);
  return scopedAssignments.some(
    (assignment) => normalizeClientId(assignment.clientId) === normalized,
  );
}

export function isClientMasterInScope(scopedAssignments, master = {}) {
  if (scopedAssignments === null || scopedAssignments === undefined) return true;
  if (!Array.isArray(scopedAssignments) || !scopedAssignments.length) return false;
  return scopedAssignments.some((assignment) => masterMatchesProgramScope(master, assignment));
}
