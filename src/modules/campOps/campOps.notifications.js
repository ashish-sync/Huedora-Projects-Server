import { notifyCampCoordinatorStakeholders } from './campOps.coordinatorNotify.js';
import { Notification } from '../notifications/notification.model.js';
import { User } from '../users/user.model.js';
import { Role } from '../users/role.model.js';
import { PERMISSIONS } from '../../config/constants.js';

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
  await Promise.all(approvers.map((user) => Notification.create({
    userId: user._id,
    type,
    title,
    body,
    entityType: 'camp_ops_camp',
    entityId: camp._id,
  })));
}

export async function notifyCampRequester({ camp, type, title, body }) {
  const requesterId = camp.createdById || camp.submittedById;
  if (!requesterId) return;
  await Notification.create({
    userId: requesterId,
    type,
    title,
    body,
    entityType: 'camp_ops_camp',
    entityId: camp._id,
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
      await notifyCoordinatorTeam({
        camp,
        type: 'CAMP_REVIEW',
        title: `Camp ${label} needs review`,
        body: summary,
        excludeUserIds: [actorId],
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
      await notifyCampRequester({
        camp,
        type: 'CAMP_APPROVED',
        title: `Camp ${label} approved`,
        body: summary,
      });
      break;
    case 'reject':
      await notifyCampRequester({
        camp,
        type: 'CAMP_REJECTED',
        title: `Camp ${label} refused`,
        body: note || camp.rejectionReason || summary,
      });
      break;
    case 'request_information':
      await notifyCampRequester({
        camp,
        type: 'CAMP_INFO_REQUESTED',
        title: `Information requested for camp ${label}`,
        body: note || camp.informationRequestNote || summary,
      });
      await notifyCoordinatorTeam({
        camp,
        type: 'CAMP_INFO_REQUESTED',
        title: `Information requested for camp ${label}`,
        body: note || camp.informationRequestNote || summary,
        excludeUserIds: [actorId],
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
      await notifyCoordinatorTeam({
        camp,
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
      break;
  }
}
