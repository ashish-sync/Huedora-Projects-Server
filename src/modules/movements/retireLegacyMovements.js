import { Movement } from './movement.model.js';
import { Asset } from '../assets/asset.model.js';
import { AssetRequest } from '../assetRequests/assetRequest.model.js';

/**
 * Clear asset.openMovementId when it points at a legacy Movement document
 * (not a Goods Issuance AssetRequest). Safe to run repeatedly.
 */
export async function clearStaleLegacyMovementLocks() {
  const assets = await Asset.find({
    isDeleted: false,
    openMovementId: { $ne: null },
  });
  let cleared = 0;
  for (const asset of assets) {
    const lockId = asset.openMovementId;
    if (!lockId) continue;
    const issuance = await AssetRequest.findOne({ _id: lockId, isDeleted: false });
    if (issuance) continue;
    const movement = await Movement.findOne({ _id: lockId });
    if (!movement) continue;
    asset.openMovementId = null;
    if (typeof asset.save === 'function') await asset.save();
    cleared += 1;
  }
  if (cleared) {
    console.info(`[movements] cleared ${cleared} legacy openMovementId lock(s)`);
  }
  return { cleared };
}
