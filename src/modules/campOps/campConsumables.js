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

/**
 * Consumables Tracking must be filled before Finance.
 * Usage and Wastage require explicit values — enter 0 if none used.
 * - Mapped mode: every non-excluded mapped item must be complete.
 * - Freeform mode: every selected (non-excluded) product row must be complete.
 */
export function getConsumablesCompletionBlockers(mapped = [], rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const blockers = [];

  if (Array.isArray(mapped) && mapped.length) {
    const byId = Object.fromEntries(
      list.map((row) => [String(row?.productId || ''), row]),
    );
    for (const item of mapped) {
      const productId = String(item?.productId || '');
      if (!productId) continue;
      const row = byId[productId] || {};
      if (row.excluded === true) continue;
      if (!isConsumableRowComplete(row)) {
        const name = String(item.itemName || row.itemName || 'consumable').trim() || 'consumable';
        blockers.push(`Enter Usage and Wastage for ${name} (use 0 if none)`);
      }
    }
    return blockers;
  }

  for (const row of list) {
    if (row?.excluded === true) continue;
    const productId = String(row?.productId || '').trim();
    if (!productId) continue;
    if (!isConsumableRowComplete(row)) {
      const name = String(row.itemName || 'consumable').trim() || 'consumable';
      blockers.push(`Enter Usage and Wastage for ${name} (use 0 if none)`);
    }
  }
  return blockers;
}

export function normalizeConsumablesUsed(rows = [], { requiredProductIds = [] } = {}) {
  if (!Array.isArray(rows)) return [];
  void requiredProductIds;
  return rows
    .filter((row) => !row?.excluded)
    .map((row) => {
      const productId = String(row?.productId || '').trim();
      if (!productId) return null;
      const qtyFilled = isConsumableQuantityFilled(row?.quantityUsed);
      const wasteFilled = isConsumableQuantityFilled(row?.wastage);
      return {
        productId,
        itemName: String(row?.itemName || '').trim(),
        // Preserve unfilled quantities as '' so incomplete rows are not coerced away.
        quantityUsed: qtyFilled ? Math.max(0, Number(row.quantityUsed)) : '',
        wastage: wasteFilled ? Math.max(0, Number(row.wastage)) : '',
        unit: String(row?.unit || '').trim(),
        uomId: String(row?.uomId || '').trim(),
      };
    })
    .filter(Boolean);
}

export function formatConsumablesUsedSummary(rows = []) {
  return normalizeConsumablesUsed(rows)
    .map((row) => `${row.itemName} | ${row.quantityUsed} | ${row.wastage}`)
    .join('; ');
}
