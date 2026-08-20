import { notifyCampCoordinatorStakeholders } from './campOps.coordinatorNotify.js';
import { notifyEvent } from '../notifications/notifyEvent.js';
import { User } from '../users/user.model.js';
import { Role } from '../users/role.model.js';
import { PERMISSIONS } from '../../config/constants.js';
import {
  NOTIFICATION_PRIORITIES,
} from '../notifications/notificationCatalog.js';

async function findCampApprovers(excludeUserId = null) {
  const roles = await Role.find({ isDeleted: false });
  const roleById = new Map(roles.map((role) => [String(role._id), role]));
  const users = await User.find({ isDeleted: false, isActive: true });

  return users.filter((user) => {
    if (excludeUserId && String(user._id) === String(excludeUserId)) return false;
    const roleIds = (user.roleIds || []).map((id) => String(id?._id || id));
    return roleIds.some((roleId) => {
      const role = roleById.get(roleId);
      if (!role) return false;
      const perms = role.permissions || [];
      return (
        perms.includes(PERMISSIONS.ALL)
        || perms.includes('*')
        || perms.includes(PERMISSIONS.CAMPS_APPROVE)
        || ['Approver', 'Admin'].includes(role.name)
      );
    });
  });
}

function campSummary(camp = {}) {
  const parts = [
    camp.clientName,
    camp.campaignName,
    camp.campDate,
  ].filter(Boolean);
  return parts.join(' · ') || 'Camp One request';
}

export async function notifyCampApprovers({ camp, actorId, type, title, body }) {
  const approvers = await findCampApprovers(actorId);
  await notifyEvent({
    type,
    title,
    body,
    entityType: 'camp_ops_camp',
    entityId: camp._id,
    recipients: approvers.map((user) => user._id),
    includeWatchers: true,
    excludeUserIds: actorId ? [actorId] : [],
    excludeActor: true,
    actor: actorId ? { _id: actorId } : null,
    module: 'camp',
    group: true,
  });
}

export async function notifyCampRequester({ camp, type, title, body, priority }) {
  const requesterId = camp.createdById || camp.submittedById;
  if (!requesterId) return;
  await notifyEvent({
    type,
    title,
    body,
    entityType: 'camp_ops_camp',
    entityId: camp._id,
    recipients: [requesterId],
    includeWatchers: false,
    module: 'camp',
    priority,
    group: true,
  });
}

async function notifyCoordinatorTeam({
  camp,
  type,
  title,
  body,
  excludeUserIds = [],
}) {
  await notifyCampCoordinatorStakeholders({
    camp,
    type,
    title,
    body,
    excludeUserIds,
  });
}

/**
 * Bulk camp actions → one summary notification (not N per camp).
 * Detail remains in Audit Trail.
 */
export async function notifyCampBulkSummary({
  action,
  actorId,
  success = [],
  failed = [],
  skipped = [],
} = {}) {
  const ok = success.length;
  const fail = failed.length;
  const skip = skipped.length;
  if (ok + fail + skip === 0) return [];

  const verb =
    action === 'approve'
      ? 'approved'
      : action === 'reject'
        ? 'refused'
        : action === 'upload' || action === 'import'
          ? 'imported'
          : String(action || 'processed');

  const title = `Camp bulk ${verb}: ${ok} succeeded${skip ? `, ${skip} skipped` : ''}${
    fail ? `, ${fail} failed` : ''
  }`;
  const bodyParts = [];
  if (ok) bodyParts.push(`${ok} ${verb}`);
  if (skip) bodyParts.push(`${skip} skipped`);
  if (fail) {
    const reasons = failed
      .slice(0, 5)
      .map((row) => row.reason || row.campId || row.id)
      .filter(Boolean);
    bodyParts.push(`${fail} failed${reasons.length ? ` (${reasons.join('; ')})` : ''}`);
  }

  const primaryCamp = success[0] || failed[0] || null;
  const entityId = primaryCamp?.id || primaryCamp?._id || null;

  const type =
    fail > 0
      ? 'CAMP_BULK_PARTIAL'
      : action === 'reject'
        ? 'CAMP_BULK_REJECT'
        : 'CAMP_BULK_SUCCESS';

  const priority =
    fail > 0
      ? NOTIFICATION_PRIORITIES.CRITICAL
      : NOTIFICATION_PRIORITIES.IMPORTANT;

  const recipients = actorId ? [actorId] : [];
  if (!recipients.length) return [];

  return notifyEvent({
    type,
    title,
    body: bodyParts.join(' · '),
    entityType: entityId ? 'camp_ops_camp' : null,
    entityId,
    recipients,
    includeWatchers: false,
    excludeUserIds: [],
    module: 'camp',
    priority,
    group: false,
    groupKey: `camp_bulk:${action}:${Date.now()}`,
    meta: {
      action,
      successCount: ok,
      failedCount: fail,
      skippedCount: skip,
      deepLinkHint: 'camp_manage',
    },
  });
}

/**
 * Actionable Camp One notifications only.
 * Routine stage saves / success chatter stay in Audit Trail — not the inbox.
 */
export async function notifyCampWorkflow({ camp, action, actorId, note = '' }) {
  const label = camp.campId || String(camp._id || '').slice(-6);
  const summary = campSummary(camp);

  switch (action) {
    case 'submit_review':
    case 'create':
      await notifyCampApprovers({
        camp,
        actorId,
        type: 'CAMP_REVIEW',
        title: `Camp ${label} needs review`,
        body: summary,
      });
      if (camp.submittedOffHours) {
        await notifyCoordinatorTeam({
          camp,
          type: 'CAMP_OFF_HOURS',
          title: `Off-hours camp submitted: ${label}`,
          body: summary,
          excludeUserIds: [actorId],
        });
      }
      if (camp.submittedWeekendAttention) {
        await notifyCoordinatorTeam({
          camp,
          type: 'CAMP_WEEKEND_ATTENTION',
          title: `Weekend camp needs attention: ${label}`,
          body: summary,
          excludeUserIds: [actorId],
        });
      }
      break;
    case 'approve':
      // Requester only — no fan-out to every coordinator on routine approve.
      await notifyCampRequester({
        camp,
        type: 'CAMP_APPROVED',
        title: `Camp ${label} approved`,
        body: summary,
        priority: NOTIFICATION_PRIORITIES.IMPORTANT,
      });
      break;
    case 'reject':
      await notifyCampRequester({
        camp,
        type: 'CAMP_REJECTED',
        title: `Camp ${label} refused`,
        body: note || camp.rejectionReason || summary,
        priority: NOTIFICATION_PRIORITIES.CRITICAL,
      });
      break;
    case 'request_information':
      await notifyCampRequester({
        camp,
        type: 'CAMP_INFO_REQUESTED',
        title: `Information requested for camp ${label}`,
        body: note || camp.informationRequestNote || summary,
        priority: NOTIFICATION_PRIORITIES.IMPORTANT,
      });
      break;
    case 'review_overdue':
      await notifyCampApprovers({
        camp,
        actorId: null,
        type: 'CAMP_REVIEW_OVERDUE',
        title: `Camp review overdue: ${label}`,
        body: summary,
      });
      break;
    case 'execution_overdue':
      await notifyCoordinatorTeam({
        camp,
        type: 'CAMP_EXECUTION_OVERDUE',
        title: `Camp execution overdue: ${label}`,
        body: summary,
      });
      break;
    default:
      // Intentionally no inbox noise for routine lifecycle saves.
      break;
  }
}
