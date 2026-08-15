import { CampOpsClientMaster } from './campOps.model.js';
import { User } from '../users/user.model.js';
import { notifyUser } from '../notifications/notifyEvent.js';
import { parseAssignedUserEmails } from './campOps.clientAccess.js';
import { sendCampStakeholderEmail } from './campOps.notificationEmail.js';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function managerIdsFromCoordinators(coordinators = []) {
  return new Set(
    coordinators
      .map((user) => user.reportingManagerId)
      .filter(Boolean)
      .map(String),
  );
}

/**
 * Client Master assigned users (coordinators) and their reporting managers.
 */
export async function resolveCoordinatorStakeholders(clientId) {
  if (!clientId) return { coordinators: [], managers: [] };

  const masters = await CampOpsClientMaster.find({
    isDeleted: false,
    clientId: String(clientId),
  });

  const emailSet = new Set();
  for (const master of masters) {
    parseAssignedUserEmails(master.assignedUserEmails).forEach((email) => emailSet.add(email));
  }
  if (!emailSet.size) return { coordinators: [], managers: [] };

  const users = await User.find({ isDeleted: false, isActive: true });
  const coordinators = users.filter((user) => emailSet.has(normalizeEmail(user.email)));
  const managerIds = managerIdsFromCoordinators(coordinators);
  const managers = users.filter((user) => managerIds.has(String(user._id)));

  return { coordinators, managers };
}

async function createStakeholderNotification(user, payload) {
  return notifyUser(user._id, {
    type: payload.type,
    title: payload.title,
    body: payload.body,
    entityType: 'camp_ops_camp',
    entityId: payload.camp._id,
    channel: 'IN_APP',
    emailStatus: 'SKIPPED',
    includeWatchers: false,
    module: 'camp',
  });
}

async function notifyStakeholderUser({
  user,
  camp,
  type,
  title,
  body,
  audience,
}) {
  await createStakeholderNotification(user, { camp, type, title, body });
  const emailResult = await sendCampStakeholderEmail({
    user,
    camp,
    title,
    body,
    audience,
  });
  return emailResult;
}

export async function notifyCampCoordinatorStakeholders({
  camp,
  type,
  title,
  body,
  excludeUserIds = [],
}) {
  const { coordinators, managers } = await resolveCoordinatorStakeholders(camp.clientId);
  const excluded = new Set((excludeUserIds || []).filter(Boolean).map(String));
  const coordinatorRecipients = coordinators.filter((user) => !excluded.has(String(user._id)));
  const managerRecipients = managers.filter((user) => !excluded.has(String(user._id)));

  if (!coordinatorRecipients.length && !managerRecipients.length) {
    return { notified: 0, emailed: 0, emailFailed: 0 };
  }

  const results = await Promise.all([
    ...coordinatorRecipients.map((user) => notifyStakeholderUser({
      user,
      camp,
      type,
      title,
      body,
      audience: 'coordinator',
    })),
    ...managerRecipients.map((user) => notifyStakeholderUser({
      user,
      camp,
      type,
      title,
      body,
      audience: 'manager',
    })),
  ]);

  const emailed = results.filter((result) => result.sent).length;
  const emailFailed = results.filter((result) => result.error).length;

  return {
    notified: coordinatorRecipients.length + managerRecipients.length,
    emailed,
    emailFailed,
  };
}
