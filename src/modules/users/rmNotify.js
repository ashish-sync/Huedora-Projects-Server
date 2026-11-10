/**
 * Spec-driven Reporting Manager involvement for Asset / Document / Verification One.
 * Approvals go to the subject's current direct RM (admin fallback if RM is unavailable).
 * Informs never fan out to every Approver.
 */

import { writeAudit } from '../../utils/audit.js';
import { notifyEvent } from '../notifications/notifyEvent.js';
import { NOTIFICATION_PRIORITIES } from '../notifications/notificationCatalog.js';
import { notifyRmInvolvement } from './rmInvolve.js';

function asId(value) {
  if (value == null || value === '') return '';
  return String(value._id || value.id || value).trim();
}

function assetLabel(asset = {}) {
  return asset.deviceNameSnapshot || asset.assetTag || asset.serialNumber || 'Asset';
}

export async function notifyRmAssetCreated({ asset, actor } = {}) {
  const subjectUserId = asId(actor);
  if (!subjectUserId || !asset?._id) return [];
  const label = assetLabel(asset);
  const rows = await notifyRmInvolvement({
    level: 'approve',
    subjectUserId,
    actor,
    type: 'ASSET_CREATE_APPROVAL',
    title: `Approval required — new asset ${label}`,
    body: [asset.serialNumber, asset.agreementStatus, asset.custody].filter(Boolean).join(' · '),
    entityType: 'Asset',
    entityId: asset._id,
    excludeActor: true,
    includeWatchers: false,
    module: 'assets',
    priority: NOTIFICATION_PRIORITIES.IMPORTANT,
    meta: { reason: 'asset_create' },
  });
  await writeAudit({
    actorId: asId(actor) || null,
    actorEmail: actor?.email || null,
    action: 'RM.ASSET_CREATE_APPROVAL',
    entityType: 'Asset',
    entityId: asset._id,
    after: { recipientCount: rows.length },
    source: 'Automation',
  });
  return rows;
}

export async function notifyRmAssetChanged({
  asset,
  actor,
  statusChanged = false,
  custodyChanged = false,
  fromStatus,
  toStatus,
  fromCustody,
  toCustody,
} = {}) {
  if (!statusChanged && !custodyChanged) return [];
  const subjectUserId = asId(actor);
  if (!subjectUserId || !asset?._id) return [];
  const bits = [];
  if (statusChanged) bits.push(`Status: ${fromStatus || '—'} → ${toStatus || '—'}`);
  if (custodyChanged) bits.push(`Custody: ${fromCustody || '—'} → ${toCustody || '—'}`);
  const rows = await notifyRmInvolvement({
    level: 'inform',
    subjectUserId,
    actor,
    type: 'ASSET_CHANGE',
    title: `${assetLabel(asset)} ${statusChanged ? 'status' : 'custody'} updated`,
    body: bits.join(' · '),
    entityType: 'Asset',
    entityId: asset._id,
    excludeActor: true,
    includeWatchers: false,
    module: 'assets',
    priority: NOTIFICATION_PRIORITIES.INFORMATIONAL,
    meta: { statusChanged, custodyChanged },
  });
  await writeAudit({
    actorId: asId(actor) || null,
    actorEmail: actor?.email || null,
    action: 'RM.ASSET_CHANGE',
    entityType: 'Asset',
    entityId: asset._id,
    after: { statusChanged, custodyChanged, recipientCount: rows.length },
    source: 'Automation',
  });
  return rows;
}

export async function notifyRmAgreementTerminated({ agreement, actor } = {}) {
  const subjectUserId = asId(actor) || asId(agreement?.createdBy) || asId(agreement?.updatedBy);
  if (!subjectUserId || !agreement?._id) return [];
  const title = agreement.title || agreement.agreementNumber || 'Agreement';
  const rows = await notifyRmInvolvement({
    level: 'inform',
    subjectUserId,
    actor,
    type: 'AGREEMENT_TERMINATED',
    title: `Agreement terminated — ${title}`,
    body: [agreement.partyName, agreement.agreementNumber].filter(Boolean).join(' · '),
    entityType: 'Agreement',
    entityId: agreement._id,
    excludeActor: true,
    includeWatchers: false,
    module: 'documents',
    priority: NOTIFICATION_PRIORITIES.IMPORTANT,
  });
  await writeAudit({
    actorId: asId(actor) || null,
    actorEmail: actor?.email || null,
    action: 'RM.AGREEMENT_TERMINATED',
    entityType: 'Agreement',
    entityId: agreement._id,
    after: { recipientCount: rows.length },
    source: 'Automation',
  });
  return rows;
}

export async function notifyRmAgreementUnsigned({ agreement, actor = null, days = 7 } = {}) {
  const subjectUserId = asId(actor)
    || asId(agreement?.createdBy)
    || asId(agreement?.updatedBy)
    || asId(agreement?.sentBy);
  if (!subjectUserId || !agreement?._id) return [];
  const title = agreement.title || agreement.agreementNumber || 'Agreement';
  const rows = await notifyRmInvolvement({
    level: 'inform',
    subjectUserId,
    actor,
    type: 'AGREEMENT_UNSIGNED',
    title: `Unsigned for ${days}+ days — ${title}`,
    body: [agreement.partyName, agreement.status].filter(Boolean).join(' · '),
    entityType: 'Agreement',
    entityId: agreement._id,
    excludeActor: Boolean(actor),
    includeWatchers: false,
    module: 'documents',
    priority: NOTIFICATION_PRIORITIES.IMPORTANT,
    meta: { days },
  });
  await writeAudit({
    actorId: asId(actor) || null,
    actorType: actor ? 'USER' : 'SYSTEM',
    action: 'RM.AGREEMENT_UNSIGNED',
    entityType: 'Agreement',
    entityId: agreement._id,
    after: { days, recipientCount: rows.length },
    source: 'Automation',
  });
  return rows;
}

export async function notifyRmVerificationLinkExpired({ invite, actor = null } = {}) {
  const subjectUserId = asId(actor) || asId(invite?.sentBy);
  if (!subjectUserId || !invite?._id) return [];
  const label = invite.holderName || invite.holderEmail || invite.shortCode || 'custodian';
  const rows = await notifyRmInvolvement({
    level: 'inform',
    subjectUserId,
    actor,
    type: 'VERIFICATION_LINK_EXPIRED',
    title: `Self-verification link expired — ${label}`,
    body: `Round ${invite.round || 1} was not completed before the link expired.`,
    entityType: 'VerificationRecord',
    entityId: invite.recordId || invite._id,
    excludeActor: Boolean(actor),
    includeWatchers: false,
    module: 'assets',
    priority: NOTIFICATION_PRIORITIES.IMPORTANT,
    meta: { inviteId: String(invite._id), round: invite.round || 1 },
  });
  await writeAudit({
    actorId: asId(actor) || null,
    actorType: actor ? 'USER' : 'SYSTEM',
    action: 'RM.VERIFICATION_LINK_EXPIRED',
    entityType: 'VerificationInvite',
    entityId: invite._id,
    after: { recipientCount: rows.length },
    source: 'Automation',
  });
  return rows;
}

export async function notifyRmVerificationMonthlyReport({
  periodKey,
  recipientUserId,
  manual = 0,
  selfVerify = 0,
} = {}) {
  const recipientId = asId(recipientUserId);
  if (!recipientId || !periodKey) return [];
  const rows = await notifyEvent({
    type: 'VERIFICATION_MONTHLY_REPORT',
    title: `Verification report — ${periodKey}`,
    body: `Manual verifications: ${manual}. Self-verification links: ${selfVerify}.`,
    entityType: 'VerificationCampaign',
    entityId: periodKey,
    recipients: [recipientId],
    includeWatchers: false,
    includeReportingManagers: false,
    module: 'assets',
    priority: NOTIFICATION_PRIORITIES.INFORMATIONAL,
    group: false,
    meta: {
      involvement: 'inform',
      kind: 'update',
      periodKey,
      manual,
      selfVerify,
      deepLinkHint: 'verification_one',
    },
  });
  await writeAudit({
    actorType: 'SYSTEM',
    action: 'RM.VERIFICATION_MONTHLY_REPORT',
    entityType: 'VerificationCampaign',
    entityId: periodKey,
    after: { recipientUserId: recipientId, manual, selfVerify, recipientCount: rows.length },
    source: 'Automation',
  });
  return rows;
}
