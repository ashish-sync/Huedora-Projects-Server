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

/**
 * Direct RM only. No skip-level. No tenant-wide Approver fan-out.
 * @returns {Promise<{ mode: 'direct_rm'|'admin_fallback'|'none', managerId: string|null, recipientIds: string[] }>}
 */
export async function resolveRmAudience({ subjectUserId } = {}) {
  const subjectId = asId(subjectUserId);
  const chain = subjectId ? await resolveManagerChainIds(subjectId, { maxDepth: 1 }) : [];
  const managerId = chain[0] || null;
  if (managerId) {
    return { mode: 'direct_rm', managerId, recipientIds: [managerId] };
  }
  const adminIds = await listPlatformAdminIds({
    excludeUserIds: subjectId ? [subjectId] : [],
  });
  if (adminIds.length) {
    return { mode: 'admin_fallback', managerId: null, recipientIds: adminIds };
  }
  return { mode: 'none', managerId: null, recipientIds: [] };
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
  meta = {},
  group = true,
} = {}) {
  const normalized = String(level || '').trim().toLowerCase();
  if (!KIND_BY_LEVEL[normalized]) {
    throw new Error(`Unknown RM involvement level: ${level}`);
  }

  const audience = await resolveRmAudience({ subjectUserId, level: normalized });
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
    meta: {
      ...(meta && typeof meta === 'object' ? meta : {}),
      involvement: normalized,
      managerId: audience.managerId,
      audienceMode: audience.mode,
      kind,
    },
  });
}
