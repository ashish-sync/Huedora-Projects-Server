import { notifyEvent } from '../notifications/notifyEvent.js';
import { notifyRmInvolvement } from '../users/rmInvolve.js';
import {
  NOTIFICATION_PRIORITIES,
} from '../notifications/notificationCatalog.js';

function campSummary(camp = {}) {
  const parts = [
    camp.clientName,
    camp.campaignName,
    camp.campDate,
  ].filter(Boolean);
  return parts.join(' · ') || 'Camp One request';
}

function campRequesterId(camp = {}) {
  return camp.createdById || camp.submittedById || null;
}

/**
 * Direct-RM Inform / Review. Never fans out to every camps:approve user.
 */
export async function notifyCampApprovers({
  camp,
  actorId,
  type,
  title,
  body,
  priority,
  level = 'inform',
}) {
  const subjectId = campRequesterId(camp) || actorId;
  if (!subjectId) return [];
  return notifyRmInvolvement({
    level,
    subjectUserId: subjectId,
    actor: actorId ? { _id: actorId } : null,
    type,
    title,
    body,
    entityType: 'camp_ops_camp',
    entityId: camp._id,
    excludeActor: true,
    includeWatchers: false,
    module: 'camp',
    priority,
  });
}

/**
 * Short HCW schedule gap (< 30m) override → Approvals for the assigner's reporting manager(s).
 */
export async function notifyCampHcwGapApproval({ camp, actorId }) {
  const assignerId = String(actorId || '').trim();
  if (!assignerId) return [];
  const label = camp.campId || String(camp._id || '').slice(-6);
  const hcw = camp.hcwName || camp.hcwContactId || 'HCW';
  return notifyRmInvolvement({
    level: 'approve',
    subjectUserId: assignerId,
    actor: { _id: assignerId },
    type: 'CAMP_HCW_GAP_APPROVAL',
    title: `Camp ${label} needs approval — HCW gap under 30 minutes`,
    body: `${hcw} · ${campSummary(camp)}. Short gap between same-day camps needs approval from your reporting manager.`,
    entityType: 'camp_ops_camp',
    entityId: camp._id,
    excludeActor: true,
    includeWatchers: false,
    module: 'camp',
    meta: { reason: 'hcw_gap_override' },
  });
}

/** Requester (no manager fan-out) plus Inform to the requester's direct RM. */
export async function notifyCampRequester({ camp, type, title, body, priority, actorId }) {
  const requesterId = campRequesterId(camp);
  if (requesterId) {
    await notifyEvent({
      type,
      title,
      body,
      entityType: 'camp_ops_camp',
      entityId: camp._id,
      recipients: [requesterId],
      includeWatchers: false,
      includeReportingManagers: false,
      module: 'camp',
      priority,
      group: true,
      meta: { kind: 'update' },
    });
  }
  const subjectId = requesterId || actorId;
  if (!subjectId) return [];
  return notifyRmInvolvement({
    level: 'inform',
    subjectUserId: subjectId,
    actor: actorId ? { _id: actorId } : null,
    type,
    title,
    body,
    entityType: 'camp_ops_camp',
    entityId: camp._id,
    excludeActor: true,
    includeWatchers: false,
    module: 'camp',
    priority,
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

  if (!actorId) return [];

  return notifyRmInvolvement({
    level: 'inform',
    subjectUserId: actorId,
    actor: { _id: actorId },
    type,
    title,
    body: bodyParts.join(' · '),
    entityType: entityId ? 'camp_ops_camp' : null,
    entityId,
    excludeActor: true,
    includeWatchers: false,
    module: 'camp',
    priority,
    group: false,
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
        title: `Camp ${label} submitted`,
        body: summary,
        priority: NOTIFICATION_PRIORITIES.INFORMATIONAL,
        level: 'inform',
      });
      if (camp.submittedOffHours) {
        await notifyCampApprovers({
          camp,
          actorId,
          type: 'CAMP_OFF_HOURS',
          title: `Off-hours camp submitted: ${label}`,
          body: summary,
          priority: NOTIFICATION_PRIORITIES.IMPORTANT,
          level: 'review',
        });
      }
      if (camp.submittedWeekendAttention) {
        await notifyCampApprovers({
          camp,
          actorId,
          type: 'CAMP_WEEKEND_ATTENTION',
          title: `Weekend camp submitted: ${label}`,
          body: summary,
          priority: NOTIFICATION_PRIORITIES.IMPORTANT,
          level: 'review',
        });
      }
      break;
    case 'approve':
      await notifyCampRequester({
        camp,
        actorId,
        type: 'CAMP_APPROVED',
        title: `Camp ${label} approved`,
        body: summary,
        priority: NOTIFICATION_PRIORITIES.IMPORTANT,
      });
      break;
    case 'reject':
      await notifyCampRequester({
        camp,
        actorId,
        type: 'CAMP_REJECTED',
        title: `Camp ${label} refused`,
        body: note || camp.rejectionReason || summary,
        priority: NOTIFICATION_PRIORITIES.CRITICAL,
      });
      break;
    case 'request_information':
      await notifyCampRequester({
        camp,
        actorId,
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
        priority: NOTIFICATION_PRIORITIES.IMPORTANT,
        level: 'review',
      });
      break;
    case 'execution_overdue':
      await notifyCampApprovers({
        camp,
        actorId: null,
        type: 'CAMP_EXECUTION_OVERDUE',
        title: `Camp execution overdue: ${label}`,
        body: summary,
        priority: NOTIFICATION_PRIORITIES.CRITICAL,
        level: 'review',
      });
      break;
    default:
      // Intentionally no inbox noise for routine lifecycle saves.
      break;
  }
}
