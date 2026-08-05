/** Shared product display helpers (aligned with Product Master Display Name). */

export function productBrandLabel(product) {
  if (!product) return '';
  return String(product.brand || product.manufacturer || '').trim();
}

export function productModelLabel(product) {
  if (!product) return '';
  return String(product.model || product.partNumber || '').trim();
}

/** Product Master Display Name (`name`), with Brand — Model fallback. */
export function productMasterDisplayName(product) {
  if (!product) return '';
  const display = String(product.name || '').trim();
  if (display) return display;
  const brand = productBrandLabel(product);
  const model = productModelLabel(product);
  if (brand && model) return `${brand} — ${model}`;
  return model || brand || '';
}

/** @deprecated Prefer productMasterDisplayName — kept for existing imports. */
export function productMasterAssetName(product) {
  return productMasterDisplayName(product);
}

export function productPurchaseCost(product) {
  if (!product) return 0;
  const cost =
    product.standardCost ?? product.defaultPerUnitCost ?? product.purchaseCost ?? product.lastPurchaseCost ?? 0;
  const n = Number(cost);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
