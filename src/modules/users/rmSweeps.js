/**
 * Time-based Reporting Manager informs:
 * - unsigned agreements (7 days)
 * - unanswered camp information requests (24 hours)
 * - expired verification self-serve links
 * - monthly verification method report
 */

import { Agreement } from '../agreements/agreement.model.js';
import { CampOpsCamp } from '../campOps/campOps.model.js';
import { Notification } from '../notifications/notification.model.js';
import {
  VerificationActivity,
  VerificationInvite,
} from '../verifications/verification.model.js';
import { User } from './user.model.js';
import { notifyRmInvolvement } from './rmInvolve.js';
import {
  notifyRmAgreementUnsigned,
  notifyRmVerificationLinkExpired,
  notifyRmVerificationMonthlyReport,
} from './rmNotify.js';
import { NOTIFICATION_PRIORITIES } from '../notifications/notificationCatalog.js';
import { writeAudit } from '../../utils/audit.js';

const UNSIGNED_MS = 7 * 24 * 60 * 60 * 1000;
const INFO_UNANSWERED_MS = 24 * 60 * 60 * 1000;

function asId(value) {
  if (value == null || value === '') return '';
  return String(value._id || value.id || value).trim();
}

function previousPeriodKey(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed; previous month is month-1
  const prev = new Date(year, month - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

export async function sweepUnsignedAgreements({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - UNSIGNED_MS).toISOString();
  const rows = await Agreement.find({ isDeleted: false });
  let notified = 0;
  for (const agreement of rows) {
    if (!['SENT', 'PARTIALLY_SIGNED'].includes(agreement.status)) continue;
    if (agreement.unsignedRmNotifiedAt) continue;
    const sentAt = agreement.sentAt || agreement.updatedAt || agreement.createdAt;
    if (!sentAt || String(sentAt) > cutoff) continue;
    await notifyRmAgreementUnsigned({ agreement, days: 7 });
    agreement.unsignedRmNotifiedAt = now.toISOString();
    await agreement.save();
    notified += 1;
  }
  return { scanned: rows.length, notified };
}

export async function sweepCampInfoUnanswered({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - INFO_UNANSWERED_MS).toISOString();
  const rows = await CampOpsCamp.find({ requestReviewStatus: 'information_requested' });
  let notified = 0;
  for (const camp of rows) {
    if (camp.informationOverdueNotifiedAt) continue;
    const askedAt = camp.informationRequestedAt;
    if (!askedAt || String(askedAt) > cutoff) continue;
    const subjectId = camp.createdById || camp.submittedById || camp.informationRequestedById;
    if (!subjectId) continue;
    const label = camp.campId || String(camp._id).slice(-6);
    await notifyRmInvolvement({
      level: 'inform',
      subjectUserId: subjectId,
      actor: null,
      type: 'CAMP_INFO_UNANSWERED',
      title: `Information request unanswered 24h — camp ${label}`,
      body: camp.informationRequestNote || [camp.clientName, camp.campDate].filter(Boolean).join(' · '),
      entityType: 'camp_ops_camp',
      entityId: camp._id,
      excludeActor: false,
      includeWatchers: false,
      module: 'camp',
      priority: NOTIFICATION_PRIORITIES.IMPORTANT,
    });
    await writeAudit({
      actorType: 'SYSTEM',
      action: 'RM.CAMP_INFO_UNANSWERED',
      entityType: 'camp_ops_camp',
      entityId: camp._id,
      source: 'Automation',
      programmeId: camp.programName || camp.drugTherapyName || null,
    });
    camp.informationOverdueNotifiedAt = now.toISOString();
    await camp.save();
    notified += 1;
  }
  return { scanned: rows.length, notified };
}

export async function sweepExpiredVerificationLinks({ now = new Date() } = {}) {
  const nowIso = now.toISOString();
  const rows = await VerificationInvite.find({
    isDeleted: false,
    status: 'PENDING',
  });
  let expired = 0;
  let notified = 0;
  for (const invite of rows) {
    if (!invite.expiresAt || String(invite.expiresAt) > nowIso) continue;
    invite.status = 'EXPIRED';
    if (!invite.rmExpiredNotifiedAt) {
      await notifyRmVerificationLinkExpired({ invite });
      invite.rmExpiredNotifiedAt = nowIso;
      notified += 1;
    }
    await invite.save();
    expired += 1;
  }
  return { scanned: rows.length, expired, notified };
}

export async function countVerificationMethods(periodKey) {
  const rows = (await VerificationActivity.find({ periodKey })).filter((row) =>
    ['MANUAL_VERIFY', 'SELF_VERIFY'].includes(row.action)
  );
  let manual = 0;
  let selfVerify = 0;
  for (const row of rows) {
    if (row.action === 'SELF_VERIFY') selfVerify += 1;
    else manual += 1;
  }
  return { periodKey, manual, selfVerify, total: manual + selfVerify };
}

export async function sweepVerificationMonthlyReport({ now = new Date() } = {}) {
  const periodKey = previousPeriodKey(now);
  const existing = (await Notification.find({ type: 'VERIFICATION_MONTHLY_REPORT' }))
    .filter((row) => String(row.meta?.periodKey || '') === periodKey);
  if (existing.length) {
    return { periodKey, sent: 0, skipped: true };
  }

  const counts = await countVerificationMethods(periodKey);
  if (!counts.total) {
    return { periodKey, sent: 0, skipped: true, ...counts };
  }

  const users = await User.find({ isDeleted: false, isActive: true });
  const managerIds = new Set();
  for (const user of users) {
    const rm = asId(user.reportingManagerId);
    if (rm) managerIds.add(rm);
  }

  let sent = 0;
  for (const managerId of managerIds) {
    const rows = await notifyRmVerificationMonthlyReport({
      periodKey,
      recipientUserId: managerId,
      manual: counts.manual,
      selfVerify: counts.selfVerify,
    });
    sent += rows.length;
  }
  return { periodKey, sent, skipped: false, ...counts };
}

export async function runRmSweeps({ now = new Date() } = {}) {
  const unsigned = await sweepUnsignedAgreements({ now });
  const info = await sweepCampInfoUnanswered({ now });
  const links = await sweepExpiredVerificationLinks({ now });
  const monthly = await sweepVerificationMonthlyReport({ now });
  return { unsigned, info, links, monthly };
}
