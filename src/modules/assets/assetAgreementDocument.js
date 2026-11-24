import { AppError } from '../../utils/helpers.js';
import { Asset } from './asset.model.js';
import { DeviceMaster } from '../devices/device.model.js';
import {
  AgreementAsset,
  AgreementDocument,
} from '../agreements/agreement.model.js';
import { isAgreementSignedStatus } from '../devices/device.constants.js';

const UNSIGNED_FALLBACK_STATUS = 'Not Initiated';

/** Document counts for Asset One Actions when a stored file or text body exists. */
export function agreementDocumentHasContent(doc) {
  if (!doc) return false;
  if (String(doc.storageKey || '').trim()) return true;
  if (String(doc.textContent || '').trim()) return true;
  return false;
}

export async function agreementHasStoredDocument(agreementId) {
  if (!agreementId) return false;
  const docs = await AgreementDocument.find({
    agreementId,
    isDeleted: false,
  })
    .select('storageKey textContent')
    .lean();
  return docs.some(agreementDocumentHasContent);
}

/**
 * True when the asset has at least one linked Document One agreement with a
 * downloadable/viewable document (Actions → agreement file).
 */
export async function assetHasStoredAgreementDocument(assetId) {
  if (!assetId) return false;
  const asset = await Asset.findOne({ _id: assetId, isDeleted: false })
    .select('_id activeAgreementId')
    .lean();
  if (!asset) return false;

  const links = await AgreementAsset.find({ assetId: asset._id }).select('agreementId').lean();
  const agreementIds = new Set(
    links.map((l) => String(l.agreementId)).filter(Boolean)
  );
  if (asset.activeAgreementId) {
    agreementIds.add(String(asset.activeAgreementId));
  }
  if (!agreementIds.size) return false;

  for (const agreementId of agreementIds) {
    if (await agreementHasStoredDocument(agreementId)) return true;
  }
  return false;
}

export async function assertCanSetAgreementSigned(assetId, { allowCreate = false } = {}) {
  if (!assetId) {
    if (allowCreate) {
      throw new AppError(
        'Asset Status cannot be Agreement Signed until a document is uploaded under Actions',
        400,
        'VALIDATION_ERROR'
      );
    }
    throw new AppError(
      'Asset Status cannot be Agreement Signed until a document is uploaded under Actions',
      400,
      'VALIDATION_ERROR'
    );
  }
  const hasDoc = await assetHasStoredAgreementDocument(assetId);
  if (!hasDoc) {
    throw new AppError(
      'Asset Status cannot be Agreement Signed until a document is uploaded under Actions',
      400,
      'VALIDATION_ERROR'
    );
  }
}

export async function assertAgreementStatusAllowsDocument(assetId, status) {
  if (!isAgreementSignedStatus(status)) return;
  await assertCanSetAgreementSigned(assetId);
}

async function clearSignedStatus(asset) {
  const previous = asset.agreementStatus;
  asset.agreementStatus = UNSIGNED_FALLBACK_STATUS;
  await asset.save();
  if (asset.deviceMasterId) {
    await DeviceMaster.updateOne(
      { _id: asset.deviceMasterId, isDeleted: false },
      { $set: { agreementStatus: UNSIGNED_FALLBACK_STATUS } }
    );
  }
  return previous;
}

/**
 * Existing Asset One rows marked Agreement Signed / Active without an Actions
 * document are reset to Not Initiated (Asset + DeviceMaster).
 */
export async function reconcileAgreementSignedWithoutDocuments() {
  const assets = await Asset.find({
    isDeleted: false,
    agreementStatus: { $in: ['Agreement Signed', 'Active'] },
  }).select('_id deviceMasterId agreementStatus activeAgreementId');

  let fixed = 0;
  const fixedIds = [];
  for (const asset of assets) {
    const hasDoc = await assetHasStoredAgreementDocument(asset._id);
    if (hasDoc) continue;
    await clearSignedStatus(asset);
    fixed += 1;
    fixedIds.push(String(asset._id));
  }

  // DeviceMaster rows that still say Agreement Signed without an Actions document
  const masters = await DeviceMaster.find({
    isDeleted: false,
    agreementStatus: { $in: ['Agreement Signed', 'Active'] },
  }).select('_id agreementStatus');

  let mastersFixed = 0;
  for (const master of masters) {
    const linked = await Asset.findOne({
      deviceMasterId: master._id,
      isDeleted: false,
    }).select('_id agreementStatus');
    if (linked) {
      const hasDoc = await assetHasStoredAgreementDocument(linked._id);
      if (hasDoc) continue;
      if (
        isAgreementSignedStatus(linked.agreementStatus) &&
        !fixedIds.includes(String(linked._id))
      ) {
        const asset = await Asset.findOne({ _id: linked._id, isDeleted: false });
        if (asset) {
          await clearSignedStatus(asset);
          fixed += 1;
          fixedIds.push(String(asset._id));
          mastersFixed += 1;
          continue;
        }
      }
    }
    await DeviceMaster.updateOne(
      { _id: master._id },
      { $set: { agreementStatus: UNSIGNED_FALLBACK_STATUS } }
    );
    mastersFixed += 1;
  }

  return {
    scanned: assets.length,
    fixed,
    mastersScanned: masters.length,
    mastersFixed,
  };
}

let agreementSignedReconcilePromise = null;

/** Run once per process (first Asset One list / seed) so existing rows heal. */
export function ensureAgreementSignedReconciled() {
  if (!agreementSignedReconcilePromise) {
    agreementSignedReconcilePromise = reconcileAgreementSignedWithoutDocuments().catch(
      (err) => {
        agreementSignedReconcilePromise = null;
        throw err;
      }
    );
  }
  return agreementSignedReconcilePromise;
}
