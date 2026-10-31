/**
 * Reporting Manager involvement engine.
 *
 * Inform managers about activity. Ask them to review exceptions.
 * Require approval only when money or authorization demands it.
 *
 * Audience is always the subject's direct RM. If there is no RM, platform
 * Admins only — never every Approver in the tenant.
 */

import { User } from './user.model.js';
import { Role } from './role.model.js';
import { resolveManagerChainIds } from './user.hierarchy.js';
import { isPlatformAdminApprover } from './approvalAuthority.js';
import { notifyEvent } from '../notifications/notifyEvent.js';

export const RM_LEVELS = Object.freeze({
  INFORM: 'inform',
  REVIEW: 'review',
  APPROVE: 'approve',
  ESCALATE: 'escalate',
});

const KIND_BY_LEVEL = Object.freeze({
  inform: 'update',
  review: 'review',
  approve: 'approval',
  escalate: 'escalate',
});

function asId(value) {
  if (value == null || value === '') return '';
  return String(value._id || value.id || value).trim();
}

function collectUserPermissions(user, roleById) {
  const set = new Set();
  for (const p of user?.grantedPermissions || user?.permissions || []) set.add(p);
  for (const raw of user?.roleIds || user?.roles || []) {
    const role = raw?.permissions ? raw : roleById.get(String(raw?._id || raw));
    for (const p of role?.permissions || []) set.add(p);
  }
  return set;
}

export async function listPlatformAdminIds({ excludeUserIds = [] } = {}) {
  const exclude = new Set((excludeUserIds || []).map((id) => String(id || '').trim()).filter(Boolean));
  const roles = await Role.find({ isDeleted: false });
  const roleById = new Map(roles.map((role) => [String(role._id), role]));
  const users = await User.find({ isDeleted: false, isActive: true });
  return users
    .filter((user) => {
      const uid = String(user._id);
      if (!uid || exclude.has(uid)) return false;
      return isPlatformAdminApprover(user, collectUserPermissions(user, roleById));
    })
    .map((user) => String(user._id));
}

async function storedReportingManagerId(subjectUserId) {
  const subjectId = asId(subjectUserId);
  if (!subjectId) return '';
  const subject = await User.findOne({ _id: subjectId, isDeleted: false });
  return asId(subject?.reportingManagerId);
}

async function managerHasRequiredPermission(managerId, requiredPermission) {
  const needed = String(requiredPermission || '').trim();
  if (!needed) return true;
  const manager = await User.findOne({ _id: managerId, isDeleted: false, isActive: true });
  if (!manager) return false;
  const roles = await Role.find({ isDeleted: false });
  const roleById = new Map(roles.map((role) => [String(role._id), role]));
  const perms = collectUserPermissions(manager, roleById);
  if (isPlatformAdminApprover(manager, perms)) return true;
  return perms.has(needed);
}

async function adminFallbackAudience(subjectId, unavailableReason) {
  const adminIds = await listPlatformAdminIds({
    excludeUserIds: subjectId ? [subjectId] : [],
  });
  if (adminIds.length) {
    return {
      mode: 'admin_fallback',
      managerId: null,
      recipientIds: adminIds,
      unavailableReason,
    };
  }
  return { mode: 'none', managerId: null, recipientIds: [], unavailableReason };
}

/**
 * Direct RM only. No skip-level. No tenant-wide Approver fan-out.
 * Inactive, deleted, or permission-ineligible RMs fall back to platform Admins.
 * @returns {Promise<{ mode: 'direct_rm'|'admin_fallback'|'none', managerId: string|null, recipientIds: string[], unavailableReason: string|null }>}
 */
export async function resolveRmAudience({ subjectUserId, requiredPermission } = {}) {
  const subjectId = asId(subjectUserId);
  const storedRmId = await storedReportingManagerId(subjectId);
  const chain = subjectId ? await resolveManagerChainIds(subjectId, { maxDepth: 1 }) : [];
  const managerId = chain[0] || null;

  if (managerId) {
    const eligible = await managerHasRequiredPermission(managerId, requiredPermission);
    if (eligible) {
      return {
        mode: 'direct_rm',
        managerId,
        recipientIds: [managerId],
        unavailableReason: null,
      };
    }
    return adminFallbackAudience(subjectId, 'no_permission');
  }

  if (storedRmId) {
    return adminFallbackAudience(subjectId, 'inactive');
  }
  return adminFallbackAudience(subjectId, 'no_rm');
}

export function involvementKind(level) {
  const key = String(level || '').trim().toLowerCase();
  return KIND_BY_LEVEL[key] || 'update';
}

/**
 * Notify the subject's direct RM (or Admins if no RM) at one involvement level.
 * Escalate is reserved — Phase 1 records the level but does not start timers.
 */
export async function notifyRmInvolvement({
  level,
  subjectUserId,
  actor = null,
  type,
  title,
  body = '',
  entityType = null,
  entityId = null,
  excludeActor = true,
  includeWatchers = false,
  module,
  priority,
  requiredPermission,
  meta = {},
  group = true,
} = {}) {
  const normalized = String(level || '').trim().toLowerCase();
  if (!KIND_BY_LEVEL[normalized]) {
    throw new Error(`Unknown RM involvement level: ${level}`);
  }

  const audience = await resolveRmAudience({
    subjectUserId,
    requiredPermission,
  });
  const kind = KIND_BY_LEVEL[normalized];
  const actorId = asId(actor);

  return notifyEvent({
    type,
    title,
    body,
    entityType,
    entityId,
    recipients: audience.recipientIds,
    actor,
    excludeActor,
    includeWatchers,
    includeReportingManagers: false,
    excludeUserIds: excludeActor && actorId ? [actorId] : [],
    module,
    priority,
    group,
    mergeWindowMs: kind === 'approval' || kind === 'review' ? Infinity : undefined,
    meta: {
      ...(meta && typeof meta === 'object' ? meta : {}),
      involvement: normalized,
      managerId: audience.managerId,
      audienceMode: audience.mode,
      unavailableReason: audience.unavailableReason,
      kind,
    },
  });
}
