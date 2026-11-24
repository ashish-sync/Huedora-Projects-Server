import { AppError } from '../../utils/helpers.js';
import { Asset } from './asset.model.js';
import {
  AgreementAsset,
  AgreementDocument,
} from '../agreements/agreement.model.js';
import { isAgreementSignedStatus } from '../devices/device.constants.js';

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
