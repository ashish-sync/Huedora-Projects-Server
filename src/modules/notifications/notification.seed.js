import { env } from '../../config/env.js';
import { User } from '../users/user.model.js';
import { CampOpsCamp } from '../campOps/campOps.model.js';
import { Notification } from './notification.model.js';
import { resolveEventMeta } from './notificationCatalog.js';
import { resolveNotificationKind } from './notificationQuery.js';

export const DEMO_NOTIFICATION_SEED_TAG = 'local-inbox-v2';

export const LOCAL_DEMO_NOTIFICATION_EMAILS = Object.freeze([
  'admin@tylo.local',
  'campadmin@tylo.local',
  'manager@tylo.local',
  'verifier@tylo.local',
]);

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

async function demoCampByCode(doctorCode) {
  return (
    (await CampOpsCamp.findOne({ doctorCode, isDeleted: false }))
    || (await CampOpsCamp.findOne({ doctorCode }))
    || null
  );
}

async function loadDemoCamps() {
  const [request, overdue, exec, finance] = await Promise.all([
    demoCampByCode('DEMO-REQ'),
    demoCampByCode('DEMO-ROVD'),
    demoCampByCode('DEMO-EXEC'),
    demoCampByCode('DEMO-FIN'),
  ]);
  return { request, overdue, exec, finance };
}

function campRef(camp, fallbackId) {
  return {
    entityType: camp?._id ? 'camp_ops_camp' : null,
    entityId: camp?._id || fallbackId || null,
    label: camp?.campId || camp?.doctorCode || 'Camp One',
  };
}

function buildRow(userId, spec) {
  const { priority, module } = resolveEventMeta(spec.type, {
    priority: spec.priority,
    module: spec.module,
  });
  const meta = {
    ...(spec.meta && typeof spec.meta === 'object' ? spec.meta : {}),
    demoSeed: DEMO_NOTIFICATION_SEED_TAG,
  };
  const kind = resolveNotificationKind({
    type: spec.type,
    title: spec.title,
    meta,
    kind: spec.kind || meta.kind,
  });
  if (!meta.kind) meta.kind = kind;
  const createdAt = spec.createdAt || hoursAgo(1);
  return {
    userId: String(userId),
    type: spec.type,
    title: spec.title,
    body: spec.body || '',
    entityType: spec.entityType || null,
    entityId: spec.entityId || null,
    channel: 'IN_APP',
    emailStatus: 'SKIPPED',
    readAt: spec.readAt || null,
    scheduledFor: null,
    deliveredAt: createdAt,
    cancelledAt: null,
    priority,
    module,
    kind,
    groupKey: `demo:local:v1:${userId}:${spec.key}`,
    groupCount: 1,
    groupedAt: null,
    actorEmail: spec.actorEmail || 'system@tylo.local',
    changes: spec.changes || [],
    meta,
    createdAt,
    updatedAt: createdAt,
  };
}

function demoSpecs(user, camps) {
  const request = campRef(camps.request, 'demo-camp-request');
  const overdue = campRef(camps.overdue, 'demo-camp-overdue');
  const exec = campRef(camps.exec, 'demo-camp-exec');
  const finance = campRef(camps.finance, 'demo-camp-finance');
  const userId = String(user._id);

  return [
    {
      key: 'approval-hcw-gap',
      type: 'CAMP_HCW_GAP_APPROVAL',
      kind: 'approval',
      title: `${request.label} needs approval — HCW gap under 30 minutes`,
      body: 'Ravi Technician is booked 20 minutes after another same-day camp. Approve the short-gap override to keep the assignment.',
      entityType: request.entityType,
      entityId: request.entityId,
      createdAt: hoursAgo(2),
      meta: { involvement: 'approve', reason: 'hcw_gap_override' },
    },
    {
      key: 'approval-asset-create',
      type: 'ASSET_CREATE_APPROVAL',
      kind: 'approval',
      title: 'New asset needs approval — BMD scanner SN-DEMO-441',
      body: 'Asset One received a create request for a BMD scanner assigned to Demo Pharma Ltd.',
      entityType: 'Asset',
      entityId: 'demo-asset-bmd-441',
      createdAt: hoursAgo(5),
    },
    {
      key: 'approval-finance',
      type: 'COMMERCIAL_SUBMIT',
      kind: 'approval',
      title: `${finance.label} payout needs approval`,
      body: 'Finance submitted a camp payout for confirmation. Review the commercial document before payment.',
      entityType: finance.entityType,
      entityId: finance.entityId,
      createdAt: hoursAgo(8),
      module: 'finance',
    },
    {
      key: 'review-overdue',
      type: 'CAMP_REVIEW',
      kind: 'review',
      title: `${overdue.label} needs your review`,
      body: 'This request has been waiting in review longer than the SLA. Open Camp One to approve or request information.',
      entityType: overdue.entityType,
      entityId: overdue.entityId,
      createdAt: hoursAgo(10),
      meta: { involvement: 'review' },
    },
    {
      key: 'review-t2',
      type: 'CAMP_INFO_REQUESTED',
      kind: 'review',
      title: `${request.label} needs a second review`,
      body: 'Camp date is more than 2 days before today. Confirm the exception before the request can move to assignment.',
      entityType: request.entityType,
      entityId: request.entityId,
      createdAt: hoursAgo(14),
      meta: { involvement: 'review' },
    },
    {
      key: 'team-approved',
      type: 'CAMP_APPROVED',
      kind: 'update',
      title: `${request.label} was approved`,
      body: 'Your team approved a Camp One request. This is an Inform copy for the reporting manager.',
      entityType: request.entityType,
      entityId: request.entityId,
      createdAt: hoursAgo(3),
      actorEmail: 'campadmin@tylo.local',
      meta: {
        involvement: 'inform',
        audienceMode: 'direct_rm',
        managerId: userId,
      },
    },
    {
      key: 'team-executed',
      type: 'ENTITY_WATCH_UPDATE',
      kind: 'update',
      title: `${exec.label} was marked executed`,
      body: 'Field team closed execution. Patient count and documents are ready for finance review.',
      entityType: exec.entityType,
      entityId: exec.entityId,
      createdAt: hoursAgo(6),
      actorEmail: 'verifier@tylo.local',
      meta: {
        involvement: 'inform',
        audienceMode: 'direct_rm',
        managerId: userId,
      },
    },
    {
      key: 'fyi-overdue',
      type: 'CAMP_REVIEW_OVERDUE',
      title: `${overdue.label} review is overdue`,
      body: 'The request is still pending review after the working-hours SLA.',
      entityType: overdue.entityType,
      entityId: overdue.entityId,
      createdAt: hoursAgo(18),
    },
    {
      key: 'fyi-approved-read',
      type: 'CAMP_APPROVED',
      title: `${exec.label} was approved`,
      body: 'Already-read sample so you can toggle Unread only and still find a closed update.',
      entityType: exec.entityType,
      entityId: exec.entityId,
      createdAt: hoursAgo(30),
      readAt: hoursAgo(20),
    },
    {
      key: 'fyi-import-errors',
      type: 'IMPORT_ERRORS',
      title: 'Camp import finished with 3 row errors',
      body: 'Download the error report from Notifications, fix the rows, and re-upload.',
      createdAt: hoursAgo(4),
      meta: { deepLinkHint: 'camp_manage' },
    },
    {
      key: 'fyi-verification',
      type: 'VERIFICATION_LINK_EXPIRED',
      title: 'Verification link expired — Demo Pharma BMD kit',
      body: 'The recipient did not complete self-verify in time. Send a new Verification One link if the check is still needed.',
      entityType: 'VerificationRecord',
      entityId: 'demo-verification-expired',
      createdAt: hoursAgo(12),
      meta: { deepLinkHint: 'verification_one' },
    },
  ];
}

export function buildDemoNotificationRows(user, camps = {}) {
  return demoSpecs(user, camps).map((spec) => buildRow(user._id, spec));
}

/** Dev-only inbox samples for local demo accounts. Never runs in production. */
export async function ensureDemoNotifications() {
  if (env.isProd) return { created: 0, users: 0, skipped: true };

  const camps = await loadDemoCamps();
  let created = 0;
  let users = 0;

  for (const email of LOCAL_DEMO_NOTIFICATION_EMAILS) {
    const user = await User.findOne({ email });
    if (!user?._id || user.isDeleted) continue;

    const existing = await Notification.find({ userId: String(user._id) });
    const demoRows = existing.filter((row) => String(row?.meta?.demoSeed || '').startsWith('local-inbox-'));
    if (demoRows.length && demoRows.every((row) => row.meta.demoSeed === DEMO_NOTIFICATION_SEED_TAG)) {
      continue;
    }
    for (const row of demoRows) {
      await Notification.deleteOne({ _id: row._id });
    }

    users += 1;
    for (const row of buildDemoNotificationRows(user, camps)) {
      await Notification.create(row);
      created += 1;
    }
  }

  return { created, users, skipped: false };
}
