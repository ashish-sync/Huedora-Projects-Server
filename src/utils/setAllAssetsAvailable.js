import { Asset } from '../modules/assets/asset.model.js';

/**
 * One-shot normalization: move all active Asset One rows to lifecycle stage Available.
 * Used for production-safe admin/system operations and deploy-time boot runs.
 */
export async function setAllAssetsAvailable({
  actorId = null,
  dryRun = false,
} = {}) {
  const assets = await Asset.find({ isDeleted: false });
  const candidates = assets.filter((asset) => String(asset.status || '') !== 'Available');
  const now = new Date().toISOString();

  if (!dryRun) {
    for (const asset of candidates) {
      asset.status = 'Available';
      asset.updatedBy = actorId ? String(actorId) : asset.updatedBy || null;
      await asset.save();
    }
  }

  return {
    dryRun: Boolean(dryRun),
    assetsScanned: assets.length,
    assetsUpdated: candidates.length,
    targetStatus: 'Available',
    updatedAt: now,
    samples: candidates.slice(0, 20).map((asset) => ({
      _id: String(asset._id),
      assetTag: asset.assetTag || null,
      serialNumber: asset.serialNumber || '',
      fromStatus: asset.status || '',
      toStatus: 'Available',
    })),
  };
}
