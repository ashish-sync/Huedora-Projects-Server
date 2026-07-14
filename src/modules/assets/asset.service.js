import { Asset } from './asset.model.js';
import { AssetEvent } from './assetEvent.model.js';
import { ASSET_TRANSITIONS } from '../../config/constants.js';
import { AppError } from '../../utils/helpers.js';
import { writeAudit } from '../../utils/audit.js';
import { nextSequence } from '../../utils/counters.js';
import { Contact } from '../contacts/contact.model.js';

export async function transitionAsset({
  assetId,
  toStatus,
  reason,
  contactId,
  hcwId, // legacy alias ignored once contactId is set
  location,
  actor,
  requestId,
  relatedEntityType,
  relatedEntityId,
  allowAdminOverride = false,
}) {
  const asset = await Asset.findOne({ _id: assetId, isDeleted: false });
  if (!asset) throw new AppError('Asset not found', 404, 'NOT_FOUND');

  const fromStatus = asset.status;
  const allowed = ASSET_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus) && !allowAdminOverride) {
    throw new AppError(
      `Transition ${fromStatus} → ${toStatus} is not allowed`,
      400,
      'INVALID_TRANSITION'
    );
  }

  if (['Assigned', 'Verified'].includes(toStatus)) {
    const targetContact = contactId || hcwId || asset.contactId;
    if (!targetContact) {
      throw new AppError('Custodian (Contact Directory) required for this status', 400, 'VALIDATION_ERROR');
    }
    const contact = await Contact.findOne({ _id: targetContact, isDeleted: false });
    if (!contact) throw new AppError('Active custodian contact required', 400, 'VALIDATION_ERROR');
    asset.contactId = contact._id;
    // Clear legacy HCW link when assigning via Contact
    asset.hcwId = null;
    asset.hcwBusinessId = null;
    if (contact.city) {
      const prev = asset.location && typeof asset.location === 'object' ? { ...asset.location } : {};
      delete prev.toObject;
      asset.location = { ...prev, city: contact.city };
    }
  }

  if (toStatus === 'Disposed' && asset.activeAgreementId) {
    throw new AppError('Cannot dispose asset with active agreement', 400, 'AGREEMENT_ACTIVE');
  }

  if (location) {
    const prev = asset.location && typeof asset.location === 'object' ? { ...asset.location } : {};
    delete prev.toObject;
    asset.location = { ...prev, ...location };
  }

  const before = { status: fromStatus, contactId: asset.contactId };
  asset.status = toStatus;
  asset.updatedBy = actor?._id;
  await asset.save();

  await AssetEvent.create({
    assetId: asset._id,
    eventType: 'STATUS_TRANSITION',
    fromStatus,
    toStatus,
    toContactId: asset.contactId,
    toLocation: asset.location,
    reason,
    relatedEntityType,
    relatedEntityId,
    actorId: actor?._id,
    requestId,
  });

  await writeAudit({
    actorId: actor?._id,
    actorEmail: actor?.email,
    action: 'ASSET.TRANSITION',
    entityType: 'Asset',
    entityId: asset._id,
    before,
    after: { status: toStatus, contactId: asset.contactId },
    requestId,
  });

  return asset;
}

export async function createAsset(payload, actor) {
  const assetTag = payload.assetTag || (await nextSequence('assetTag', 'AST'));
  const qrCode = payload.qrCode || `DHUB-${assetTag.replace(/^AST-/, '')}`;
  const asset = await Asset.create({
    ...payload,
    assetTag,
    qrCode,
    createdBy: actor?._id,
    updatedBy: actor?._id,
  });
  await AssetEvent.create({
    assetId: asset._id,
    eventType: 'FIELD_UPDATE',
    toStatus: asset.status,
    reason: 'Asset created',
    actorId: actor?._id,
  });
  await writeAudit({
    actorId: actor?._id,
    actorEmail: actor?.email,
    action: 'ASSET.CREATE',
    entityType: 'Asset',
    entityId: asset._id,
    after: asset.toObject(),
  });
  return asset;
}
