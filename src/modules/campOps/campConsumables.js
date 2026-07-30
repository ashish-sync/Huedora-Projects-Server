export function emptyConsumableRow() {
  return {
    productId: '',
    itemName: '',
    quantityUsed: '',
    wastage: '',
    unit: '',
    uomId: '',
  };
}

export function isConsumableQuantityFilled(value) {
  if (value === '' || value === null || value === undefined) return false;
  const number = Number(value);
  return !Number.isNaN(number) && number >= 0;
}

export function isConsumableRowComplete(row = {}) {
  return isConsumableQuantityFilled(row.quantityUsed)
    && isConsumableQuantityFilled(row.wastage);
}

export function mergeConsumablesWithTemplate(mapped = [], existing = []) {
  if (!Array.isArray(mapped) || !mapped.length) {
    return Array.isArray(existing) && existing.length ? existing : [emptyConsumableRow()];
  }
  const existingById = Object.fromEntries(
    (existing || []).map((row) => [String(row.productId), row]),
  );
  return mapped.map((item) => {
    const saved = existingById[String(item.productId)] || {};
    return {
      productId: item.productId,
      itemName: item.itemName || saved.itemName || '',
      unit: item.unit || saved.unit || '',
      uomId: item.uomId || saved.uomId || '',
      quantityUsed: saved.quantityUsed ?? '',
      wastage: saved.wastage ?? '',
    };
  });
}

export function getConsumablesCompletionBlockers(mapped = [], rows = []) {
  if (!Array.isArray(mapped) || !mapped.length) return [];
  const rowsById = Object.fromEntries((rows || []).map((row) => [String(row.productId), row]));
  return mapped
    .filter((item) => !isConsumableRowComplete(rowsById[String(item.productId)] || {}))
    .map((item) => `Enter usage and wastage for ${item.itemName || 'consumable'}`);
}

export function normalizeConsumablesUsed(rows = [], { requiredProductIds = [] } = {}) {
  if (!Array.isArray(rows)) return [];
  const required = new Set((requiredProductIds || []).map(String));
  return rows
    .map((row) => ({
      productId: String(row?.productId || '').trim(),
      itemName: String(row?.itemName || '').trim(),
      quantityUsed: Math.max(0, Number(row?.quantityUsed) || 0),
      wastage: Math.max(0, Number(row?.wastage) || 0),
      unit: String(row?.unit || '').trim(),
      uomId: String(row?.uomId || '').trim(),
    }))
    .filter((row) => {
      if (!row.productId) return false;
      if (required.has(row.productId)) return isConsumableRowComplete(row);
      return row.quantityUsed > 0;
    });
}

export function formatConsumablesUsedSummary(rows = []) {
  return normalizeConsumablesUsed(rows)
    .map((row) => `${row.itemName} | ${row.quantityUsed} | ${row.wastage}`)
    .join('; ');
}
