/** Brand / Manufacturer – Model/Variant/Name (canonical display for assets & movements). */

export function productBrandLabel(product) {
  if (!product) return '';
  return String(product.brand || product.manufacturer || '').trim();
}

export function productModelLabel(product) {
  if (!product) return '';
  return String(product.model || product.partNumber || product.name || '').trim();
}

/** Full asset / catalog name: "Brand - Model" */
export function productMasterAssetName(product) {
  if (!product) return '';
  const brand = productBrandLabel(product);
  const model = productModelLabel(product);
  if (brand && model) return `${brand} - ${model}`;
  return model || brand || '';
}

/** Dropdown label for Model/Variant/Name picker */
export function productMasterOptionLabel(product) {
  if (!product) return '';
  const model = productModelLabel(product);
  if (!model) return product.code ? String(product.code) : '';
  return product.code ? `${model} (${product.code})` : model;
}

export function productPurchaseCost(product) {
  if (!product) return 0;
  const cost = product.standardCost ?? product.defaultPerUnitCost ?? product.lastPurchaseCost ?? 0;
  const n = Number(cost);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
