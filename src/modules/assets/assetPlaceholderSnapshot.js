import { LogisticsProduct } from '../logistics/logistics.model.js';
import {
  productMasterAssetName,
  productModelLabel,
} from '../logistics/productMasterLabel.js';

/**
 * Resolve Asset Registry values for Document One merge placeholders.
 */
export async function buildAssetPlaceholderSnapshot(assetRow) {
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

  return {
    assetId: assetRow._id,
    assetName,
    model,
    serialNumber: String(assetRow.serialNumber || '').trim(),
    assetTag: String(assetRow.assetTag || '').trim(),
    productType: assetRow.productType || '',
  };
}
