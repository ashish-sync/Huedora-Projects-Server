/**
 * Shared approval authority for Request One + Finance One.
 *
 * Standard: creator/requestor/submitter cannot approve their own item — only their
 * designated Reporting Manager may approve.
 *
 * Exempt: Director, Business Head, or any Manager designation (and platform Admin)
 * may create and approve their own submissions and approve others'.
 */

import { AppError } from '../../utils/helpers.js';
import { User } from './user.model.js';
import { PERMISSIONS } from '../../config/constants.js';

export function normalizeDesignationKey(designation) {
  return String(designation || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Director, Business Head, or any Manager-title designation.
 * Matches: Manager, Senior Manager, Operations Manager, Training Manager, Product Manager, etc.
 */
export function isApprovalExemptDesignation(designation) {
  const key = normalizeDesignationKey(designation);
  if (!key) return false;
  if (key === 'director' || key.endsWith(' director') || key.startsWith('director ')) return true;
  if (key === 'business head' || key.includes('business head')) return true;
  // Word-boundary style: "... manager" or "manager ..."
  if (/(^|\s)manager(\s|$)/.test(key)) return true;
  return false;
}

function collectPermissions(user, permissions) {
  if (permissions instanceof Set) return permissions;
  if (Array.isArray(permissions)) return new Set(permissions);
  const set = new Set();
  for (const p of user?.grantedPermissions || user?.permissions || []) set.add(p);
  for (const role of user?.roleIds || user?.roles || []) {
    for (const p of role?.permissions || []) set.add(p);
  }
  return set;
}

export function isPlatformAdminApprover(user, permissions) {
  const perms = collectPermissions(user, permissions);
  return perms.has(PERMISSIONS.ALL) || perms.has('*');
}

export function isApprovalAuthorityExempt(user, permissions) {
  if (isPlatformAdminApprover(user, permissions)) return true;
  return isApprovalExemptDesignation(user?.designation);
}

function actorIdOf(user) {
  return String(user?._id || user?.id || '').trim();
}

/**
 * Whether `actor` is the direct reporting manager of `subjectUserId`.
 */
export async function isDirectReportingManager(actorUserId, subjectUserId) {
  const actorId = String(actorUserId || '').trim();
  const subjectId = String(subjectUserId || '').trim();
  if (!actorId || !subjectId || actorId === subjectId) return false;
  const subject = await User.findOne({ _id: subjectId, isDeleted: false });
  if (!subject) return false;
  const managerId = subject.reportingManagerId
    ? String(subject.reportingManagerId._id || subject.reportingManagerId)
    : '';
  return Boolean(managerId && managerId === actorId);
}

/**
 * Enforce Option A approval authority.
 * @param {{ actor: object, subjectUserId: string, permissions?: Set|string[], action?: string }} args
 */
export async function assertApprovalAuthority({
  actor,
  subjectUserId,
  permissions,
  action = 'approve',
} = {}) {
  const actorId = actorIdOf(actor);
  const subjectId = String(subjectUserId || '').trim();
  if (!actorId) {
    throw new AppError('Not authenticated', 401, 'UNAUTHORIZED');
  }
  if (!subjectId) {
    throw new AppError(
      'Cannot determine the creator/requestor for approval',
      400,
      'VALIDATION_ERROR',
    );
  }

  const exempt = isApprovalAuthorityExempt(actor, permissions);
  const isSelf = actorId === subjectId;

  if (isSelf) {
    if (exempt) return { mode: 'self_exempt' };
    throw new AppError(
      `Segregation of duties: you cannot ${action} your own submission. It must be approved by your Reporting Manager.`,
      403,
      'SOD_VIOLATION',
    );
  }

  if (exempt) return { mode: 'exempt' };

  const isRm = await isDirectReportingManager(actorId, subjectId);
  if (isRm) return { mode: 'reporting_manager' };

  throw new AppError(
    `Only the submitter's Reporting Manager (or Director / Business Head / Manager) can ${action} this item`,
    403,
    'FORBIDDEN',
  );
}

/** Sync helper for UI: whether actor may approve a subject (needs subject.reportingManagerId when not exempt). */
export function canActorApproveSubjectSync(actor, subject, permissions) {
  const actorId = actorIdOf(actor);
  const subjectId = String(subject?._id || subject?.id || subjectUserIdLoose(subject) || '').trim();
  if (!actorId || !subjectId) return false;
  if (isApprovalAuthorityExempt(actor, permissions)) return true;
  if (actorId === subjectId) return false;
  const managerId = subject?.reportingManagerId
    ? String(subject.reportingManagerId._id || subject.reportingManagerId)
    : '';
  return Boolean(managerId && managerId === actorId);
}

function subjectUserIdLoose(subject) {
  if (typeof subject === 'string' || typeof subject === 'number') return subject;
  return '';
}

/** Lightweight subject payload for client UI gates. */
export async function resolveApprovalSubject(subjectUserId) {
  const id = String(subjectUserId || '').trim();
  if (!id) return null;
  const subject = await User.findOne({ _id: id, isDeleted: false });
  if (!subject) return { _id: id, reportingManagerId: null };
  return {
    _id: String(subject._id),
    reportingManagerId: subject.reportingManagerId
      ? String(subject.reportingManagerId._id || subject.reportingManagerId)
      : null,
  };
}
