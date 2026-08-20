import { LogisticsProduct } from '../logistics/logistics.model.js';
import {
  productMasterAssetName,
  productModelLabel,
} from '../logistics/productMasterLabel.js';
import { formatOwnershipType } from '../devices/device.constants.js';

function identityId(value) {
  if (value && typeof value === 'object') {
    return value._id || value.id || value;
  }
  return value;
}

/**
 * Resolve Asset Registry values for Document One merge placeholders
 * and freeze them onto the agreement for audit integrity.
 */
export async function buildAssetPlaceholderSnapshot(assetRow, { source = 'live' } = {}) {
  if (!assetRow) return null;

  let product = null;
  const productId =
    assetRow.productId ||
    assetRow.deviceMasterId?.productId ||
    (typeof assetRow.deviceMasterId === 'object' ? assetRow.deviceMasterId?.productId : null);

  if (productId) {
    product = await LogisticsProduct.findOne({ _id: productId, isDeleted: false });
  }

  const assetName =
    String(assetRow.deviceNameSnapshot || '').trim() ||
    productMasterAssetName(product) ||
    String(assetRow.deviceMasterId?.name || '').trim() ||
    '';

  const model =
    productModelLabel(product) ||
    String(assetRow.deviceMasterId?.name || '').trim() ||
    '';

  const ownershipType = formatOwnershipType(
    assetRow.assetType || assetRow.deviceMasterId?.assetType || '',
  );

  return {
    assetId: String(identityId(assetRow._id) || ''),
    productType: String(assetRow.productType || '').trim(),
    assetName,
    ownershipType,
    serialNumber: String(assetRow.serialNumber || '').trim(),
    model,
    assetTag: String(assetRow.assetTag || '').trim(),
    capturedAt: new Date().toISOString(),
    capturedSource: source,
  };
}

export function snapshotHasIdentity(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  return Boolean(
    String(snapshot.assetId || '').trim()
    || String(snapshot.serialNumber || '').trim()
    || String(snapshot.assetName || '').trim(),
  );
}
