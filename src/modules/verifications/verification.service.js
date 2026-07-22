import { AppError } from '../../utils/helpers.js';
import { formatDateTime } from '../../utils/dateFormat.js';
import { writeAudit } from '../../utils/audit.js';
import {
  VerificationRecord,
  VerificationInvite,
  VerificationActivity,
} from './verification.model.js';
import { Asset } from '../assets/asset.model.js';
import { Contact } from '../contacts/contact.model.js';
import { transitionAsset } from '../assets/asset.service.js';
import { computeDeviceCondition } from './verification.condition.js';
import { createUniqueInviteCodes } from './verificationAccess.js';
import { PHYSICAL_CHECK, FUNCTIONALITY_CHECK } from '../../config/constants.js';
import { Notification } from '../notifications/notification.model.js';

const INVITE_TTL_DAYS = 7;
const INVITE_TTL_ALLOWED = [1, 3, 7, 14, 30];

function resolveInviteTtlDays(raw) {
  const n = Number(raw);
  if (Number.isFinite(n) && INVITE_TTL_ALLOWED.includes(n)) return n;
  return INVITE_TTL_DAYS;
}

export async function logVerificationActivity({
  recordId,
  assetId,
  campaignId,
  periodKey,
  round,
  action,
  actor,
  message,
  meta,
}) {
  return VerificationActivity.create({
    recordId,
    assetId,
    campaignId,
    periodKey,
    round,
    action,
    at: new Date().toISOString(),
    actorId: actor?.id || actor?._id || null,
    actorEmail: actor?.email || null,
    actorName: actor?.fullName || actor?.name || null,
    message,
    meta: meta || null,
  });
}

function photoUrl(filename) {
  return filename ? `/uploads/verifications/${filename}` : null;
}

export const PHOTO_KIND = {
  FULL_DEVICE: 'FULL_DEVICE',
  SERIAL_VISIBLE: 'SERIAL_VISIBLE',
  ADDITIONAL: 'ADDITIONAL',
};

/**
 * Normalize uploaded verification photos.
 * Requires FULL_DEVICE + SERIAL_VISIBLE; ADDITIONAL is optional (0..n).
 * Legacy single photoFilename still accepted as FULL_DEVICE only (rejected until serial present).
 */
export function buildRoundPhotos(payload = {}) {
  const list = Array.isArray(payload.photos) ? payload.photos.filter(Boolean) : [];
  const photos = list
    .map((p) => ({
      kind: String(p.kind || PHOTO_KIND.ADDITIONAL).toUpperCase(),
      filename: p.filename || p.photoFilename || null,
      name: p.name || p.photoName || null,
    }))
    .filter((p) => p.filename)
    .map((p) => ({
      kind: Object.values(PHOTO_KIND).includes(p.kind) ? p.kind : PHOTO_KIND.ADDITIONAL,
      url: photoUrl(p.filename),
      name: p.name || null,
    }));

  // Legacy single-file fallback → treat as full device only (still need serial)
  if (!photos.length && payload.photoFilename) {
    photos.push({
      kind: PHOTO_KIND.FULL_DEVICE,
      url: photoUrl(payload.photoFilename),
      name: payload.photoName || null,
    });
  }

  const hasFull = photos.some((p) => p.kind === PHOTO_KIND.FULL_DEVICE);
  const hasSerial = photos.some((p) => p.kind === PHOTO_KIND.SERIAL_VISIBLE);
  if (!hasFull) {
    throw new AppError('Full device photo is required', 400, 'VALIDATION_ERROR');
  }
  if (!hasSerial) {
    throw new AppError('Device photo with serial number visible is required', 400, 'VALIDATION_ERROR');
  }
  return photos;
}

export async function completeVerificationRound({
  record,
  roundNum,
  payload,
  actor,
  requestId,
  method = 'MANUAL',
}) {
  if (!record) throw new AppError('Verification record not found', 404);
  if (![1, 2].includes(roundNum)) {
    throw new AppError('Round must be 1 or 2', 400, 'VALIDATION_ERROR');
  }

  const key = roundNum === 1 ? 'round1' : 'round2';
  const existing = record[key] || {};
  if (existing.verifiedOn) {
    throw new AppError(`Round ${roundNum} already completed`, 400, 'ALREADY_VERIFIED');
  }

  const {
    latitude,
    longitude,
    accuracy,
    physical,
    functionality,
    callRemark,
    currentLocation,
    zone,
    custodianName,
    custodianContact,
  } = payload;

  const photos = buildRoundPhotos(payload);
  const primary =
    photos.find((p) => p.kind === PHOTO_KIND.FULL_DEVICE) || photos[0];

  if (latitude == null || longitude == null || Number.isNaN(latitude) || Number.isNaN(longitude)) {
    throw new AppError('GPS latitude and longitude are required', 400, 'VALIDATION_ERROR');
  }
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new AppError('Invalid GPS coordinates', 400, 'VALIDATION_ERROR');
  }

  const phys = String(physical || 'PASS').toUpperCase().replace(/\s+/g, '_');
  const func = String(functionality || 'CHECKED').toUpperCase().replace(/\s+/g, '_');
  if (!PHYSICAL_CHECK.includes(phys) || !FUNCTIONALITY_CHECK.includes(func)) {
    throw new AppError('Invalid physical/functionality value', 400, 'VALIDATION_ERROR');
  }

  const verifiedOn = new Date().toISOString();
  const roundPayload = {
    verifiedOn,
    physical: phys,
    functionality: func,
    photos,
    /** @deprecated prefer photos[]; kept for older readers */
    photoUrl: primary.url,
    photoName: primary.name,
    gps: {
      latitude,
      longitude,
      accuracy: accuracy != null ? Number(accuracy) : null,
      capturedAt: verifiedOn,
    },
    verifiedBy: actor?.id || actor?._id || null,
    verifiedByEmail: actor?.email || null,
    method,
  };

  record[key] = roundPayload;
  record.updatedBy = actor?.id || actor?._id || record.updatedBy;

  if (callRemark !== undefined) record.callRemark = callRemark;
  if (currentLocation !== undefined) record.currentLocation = currentLocation;
  if (zone !== undefined) record.zone = zone;
  if (custodianName !== undefined) record.custodianName = custodianName;
  if (custodianContact !== undefined) record.custodianContact = custodianContact;

  const r1 = record.round1 || {};
  const r2 = record.round2 || {};
  if (r1.verifiedOn && r2.verifiedOn) {
    record.status = 'COMPLETED';
    record.finalStatus = 'OK';
  } else {
    record.status = 'IN_PROGRESS';
  }
  await record.save();

  const asset = record.assetId
    ? await Asset.findOne({ _id: record.assetId, isDeleted: false })
    : null;

  if (asset) {
    asset.lastVerifiedAt = verifiedOn;
    asset.lastVerifiedPeriod = record.periodKey;
    if (
      phys === 'PASS' &&
      func === 'CHECKED' &&
      ['Assigned', 'Verified', 'Available', 'Purchased', 'Received', 'Warehouse'].includes(
        asset.status
      )
    ) {
      try {
        await transitionAsset({
          assetId: asset._id,
          toStatus: 'Verified',
          reason: `Verification ${record.periodKey} Round ${roundNum} (${method})`,
          actor: actor?.id ? actor : { _id: null, email: actor?.email || 'self-verify' },
          requestId,
          relatedEntityType: 'VerificationRecord',
          relatedEntityId: record._id,
          allowAdminOverride: true,
        });
      } catch {
        /* keep verification even if transition not allowed */
      }
    }
    await asset.save();
  }

  const auditAction =
    method === 'SELF_SERVICE' ? `VERIFICATION.SELF_ROUND_${roundNum}` : `VERIFICATION.ROUND_${roundNum}`;

  await writeAudit({
    actorId: actor?.id || actor?._id || null,
    actorEmail: actor?.email || null,
    action: auditAction,
    entityType: 'VerificationRecord',
    entityId: record._id,
    after: {
      round: roundNum,
      method,
      gps: roundPayload.gps,
      photoUrl: roundPayload.photoUrl,
      photos: roundPayload.photos,
    },
    requestId,
  });

  await logVerificationActivity({
    recordId: record._id,
    assetId: record.assetId,
    campaignId: record.campaignId,
    periodKey: record.periodKey,
    round: roundNum,
    action: method === 'SELF_SERVICE' ? 'SELF_VERIFY' : 'MANUAL_VERIFY',
    actor,
    message:
      method === 'SELF_SERVICE'
        ? `Round ${roundNum} completed by asset holder via secure link`
        : `Round ${roundNum} completed manually by staff`,
    meta: { method, physical: phys, functionality: func },
  });

  const condition = computeDeviceCondition(asset || {}, record);
  return { record, asset, condition };
}

const CALL_OUTCOMES = {
  NO_RESPONSE: 'No response',
  CALLBACK_LATER: 'Callback later',
  WRONG_NUMBER: 'Wrong number',
  OTHER: 'Other',
};

export async function logCallAttempt({
  record,
  roundNum,
  outcome,
  note,
  callbackAt,
  actor,
  requestId,
}) {
  if (!record) throw new AppError('Verification record not found', 404);
  if (![1, 2].includes(roundNum)) {
    throw new AppError('Round must be 1 or 2', 400, 'VALIDATION_ERROR');
  }

  const outcomeKey = String(outcome || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
  const label = CALL_OUTCOMES[outcomeKey];
  if (!label) {
    throw new AppError(
      'outcome must be NO_RESPONSE, CALLBACK_LATER, WRONG_NUMBER, or OTHER',
      400,
      'VALIDATION_ERROR'
    );
  }

  const noteText = String(note || '').trim();
  if (outcomeKey === 'OTHER' && !noteText) {
    throw new AppError('Note is required when outcome is Other', 400, 'VALIDATION_ERROR');
  }

  let callbackIso = null;
  let callbackLabel = null;
  if (outcomeKey === 'CALLBACK_LATER') {
    if (!callbackAt) {
      throw new AppError('callbackAt date/time is required for Callback later', 400, 'VALIDATION_ERROR');
    }
    const due = new Date(callbackAt);
    if (Number.isNaN(due.getTime())) {
      throw new AppError('Invalid callbackAt datetime', 400, 'VALIDATION_ERROR');
    }
    if (due.getTime() <= Date.now()) {
      throw new AppError('Callback reminder must be in the future', 400, 'VALIDATION_ERROR');
    }
    callbackIso = due.toISOString();
    callbackLabel = formatDateTime(due);
  }

  const when = new Date();
  const whenLabel = formatDateTime(when);

  let remark = `${outcomeKey}: ${whenLabel}`;
  if (callbackLabel) remark += ` · remind ${callbackLabel}`;
  if (noteText) remark += `: ${noteText}`;

  record.callRemark = remark;
  record.callbackAt = callbackIso;
  record.updatedBy = actor?.id || actor?._id || record.updatedBy;
  await record.save();

  const actorId = actor?.id || actor?._id || null;
  let notification = null;

  if (outcomeKey === 'CALLBACK_LATER' && actorId) {
    const existing = await Notification.find({
      userId: actorId,
      type: 'VERIFICATION_CALLBACK',
      entityType: 'VerificationRecord',
      entityId: record._id,
    }).limit(50);

    const cancelAt = new Date().toISOString();
    for (const n of existing) {
      if (!n.cancelledAt && !n.deliveredAt) {
        n.cancelledAt = cancelAt;
        await n.save();
      }
    }

    const asset = record.assetId
      ? await Asset.findOne({ _id: record.assetId, isDeleted: false })
      : null;
    const assetLabel =
      asset?.serialNumber || asset?.deviceNameSnapshot || record.serialNumber || 'asset';

    notification = await Notification.create({
      userId: actorId,
      type: 'VERIFICATION_CALLBACK',
      title: `Callback: ${assetLabel}`,
      body: noteText
        ? `Remind at ${callbackLabel}. ${noteText}`
        : `Remind at ${callbackLabel}. Round ${roundNum} verification callback.`,
      entityType: 'VerificationRecord',
      entityId: record._id,
      scheduledFor: callbackIso,
      deliveredAt: null,
      cancelledAt: null,
      readAt: null,
      meta: {
        round: roundNum,
        periodKey: record.periodKey,
        assetId: record.assetId || null,
        outcome: outcomeKey,
      },
    });
  }

  const messageParts = [label];
  if (callbackLabel) messageParts.push(`remind ${callbackLabel}`);
  if (noteText) messageParts.push(noteText);

  await logVerificationActivity({
    recordId: record._id,
    assetId: record.assetId,
    campaignId: record.campaignId,
    periodKey: record.periodKey,
    round: roundNum,
    action: 'CALL_ATTEMPT',
    actor,
    message: messageParts.join('. '),
    meta: {
      outcome: outcomeKey,
      note: noteText || null,
      callbackAt: callbackIso,
      notificationId: notification?._id || null,
    },
  });

  await writeAudit({
    actorId,
    actorEmail: actor?.email || null,
    action: 'VERIFICATION.CALL_ATTEMPT',
    entityType: 'VerificationRecord',
    entityId: record._id,
    after: {
      round: roundNum,
      outcome: outcomeKey,
      callRemark: remark,
      callbackAt: callbackIso,
      notificationId: notification?._id || null,
    },
    requestId,
  });

  return {
    record,
    callRemark: remark,
    outcome: outcomeKey,
    callbackAt: callbackIso,
    notification,
  };
}

export async function createSelfVerifyInvite({
  record,
  asset,
  roundNum,
  actor,
  requestId,
  validForDays,
}) {
  if (!record || !asset) throw new AppError('Record and asset required', 400);

  const key = roundNum === 1 ? 'round1' : 'round2';
  if (record[key]?.verifiedOn) {
    throw new AppError(`Round ${roundNum} already completed`, 400, 'ALREADY_VERIFIED');
  }

  let contact = null;
  if (asset.contactId) {
    contact = await Contact.findOne({ _id: asset.contactId, isDeleted: false });
  }
  if (!contact) {
    throw new AppError(
      'Assign a custodian from Contact Directory on this asset before sending a verification link',
      400,
      'NO_HOLDER_CONTACT'
    );
  }
  if (!contact.email && !contact.contact && !contact.mobile) {
    throw new AppError(
      'Custodian must have an email or phone number in Contact Directory',
      400,
      'NO_HOLDER_CONTACT'
    );
  }

  const pending = await VerificationInvite.find({
    recordId: record._id,
    round: roundNum,
    status: 'PENDING',
    isDeleted: false,
  });
  for (const inv of pending) {
    inv.status = 'CANCELLED';
    await inv.save();
  }

  const ttlDays = resolveInviteTtlDays(validForDays);
  const { accessToken, shortCode } = await createUniqueInviteCodes();
  const sentAt = new Date();
  const expiresAt = new Date(sentAt);
  expiresAt.setDate(expiresAt.getDate() + ttlDays);

  const invite = await VerificationInvite.create({
    recordId: record._id,
    assetId: asset._id,
    campaignId: record.campaignId,
    periodKey: record.periodKey,
    round: roundNum,
    accessToken,
    shortCode,
    status: 'PENDING',
    holderContactId: contact._id,
    holderName: contact.name,
    holderEmail: contact.email || '',
    holderPhone: contact.contact || contact.mobile || '',
    sentAt: sentAt.toISOString(),
    sentBy: actor?.id || actor?._id || null,
    expiresAt: expiresAt.toISOString(),
    validForDays: ttlDays,
  });

  await logVerificationActivity({
    recordId: record._id,
    assetId: asset._id,
    campaignId: record.campaignId,
    periodKey: record.periodKey,
    round: roundNum,
    action: 'LINK_SENT',
    actor,
    message: `Self-verification link sent to ${contact.name} (valid ${ttlDays} day${ttlDays === 1 ? '' : 's'})`,
    meta: {
      inviteId: invite._id,
      shortCode,
      holderEmail: invite.holderEmail,
      holderPhone: invite.holderPhone,
      expiresAt: invite.expiresAt,
      validForDays: ttlDays,
    },
  });

  await writeAudit({
    actorId: actor?.id || actor?._id || null,
    actorEmail: actor?.email || null,
    action: 'VERIFICATION.LINK_SENT',
    entityType: 'VerificationRecord',
    entityId: record._id,
    after: {
      round: roundNum,
      inviteId: invite._id,
      holderName: contact.name,
      validForDays: ttlDays,
      expiresAt: invite.expiresAt,
    },
    requestId,
  });

  return { invite, contact, validForDays: ttlDays };
}

export async function completeInviteAfterSelfVerify(invite, record) {
  invite.status = 'COMPLETED';
  invite.completedAt = new Date().toISOString();
  await invite.save();

  const otherPending = await VerificationInvite.find({
    recordId: record._id,
    round: invite.round,
    status: 'PENDING',
    isDeleted: false,
  });
  for (const inv of otherPending) {
    if (String(inv._id) !== String(invite._id)) {
      inv.status = 'CANCELLED';
      await inv.save();
    }
  }
}
