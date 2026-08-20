import { AgreementAsset } from './agreement.model.js';
import { Asset } from '../assets/asset.model.js';
import {
  buildAssetPlaceholderSnapshot,
  snapshotHasIdentity,
} from '../assets/assetPlaceholderSnapshot.js';

/**
 * Freeze live Asset One fields onto the agreement link.
 * Existing snapshots are never overwritten (audit integrity).
 */
export async function captureAgreementAssetSnapshot(link, asset = null, { source = 'link' } = {}) {
  if (!link) return link;
  if (snapshotHasIdentity(link.assetSnapshot)) return link;

  const live = asset || await Asset.findOne({ _id: link.assetId, isDeleted: false })
    .populate('deviceMasterId', 'name productId assetType');
  if (!live) return link;

  const snapshot = await buildAssetPlaceholderSnapshot(live, { source });
  if (!snapshot) return link;

  link.assetSnapshot = snapshot;
  link.snapshotCapturedAt = snapshot.capturedAt;
  await link.save();
  return link;
}

export async function freezeAgreementAssetSnapshots(agreementId, { source = 'sign' } = {}) {
  if (!agreementId) return;
  const links = await AgreementAsset.find({ agreementId, isActive: true });
  for (const link of links) {
    await captureAgreementAssetSnapshot(link, null, { source });
  }
}
