/**
 * Connect Logistics Usage (Used / Wastage) to the inventory ledger.
 *
 * Domain model:
 * - Goods Issue (Outward) already reduces warehouse stock when stock leaves the warehouse.
 * - Usage records field consumption; Field Balance = Outward − Returns − Used − Wastage.
 * - Default path writes immutable USAGE ledger lines without double-debiting warehouse qty.
 * - Optional consumeFromWarehouse + productId + warehouseId applies stock deltas
 *   (for direct warehouse consumption without a prior outward).
 */

import { AppError } from '../../utils/helpers.js';
import { LogisticsLedgerEntry, LogisticsStockItem, LogisticsUsageEntry } from './logistics.model.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function trimStr(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Apply ledger (and optional stock) for the current usage quantities vs last applied.
 * Idempotent: re-running with the same quantities is a no-op.
 *
 * @param {object} usageRow LogisticsUsageEntry document
 * @param {object|null} actor
 * @param {{ consumeFromWarehouse?: boolean }} [opts]
 */
export async function applyUsageInventoryEffect(usageRow, actor = null, opts = {}) {
  if (!usageRow?._id) {
    throw new AppError('Usage row is required', 400, 'VALIDATION_ERROR');
  }

  const used = Math.max(0, num(usageRow.screenCount ?? usageRow.usedQty));
  const waste = Math.max(0, num(usageRow.wastage));
  const prevUsed = Math.max(0, num(usageRow.appliedUsedQty));
  const prevWaste = Math.max(0, num(usageRow.appliedWastageQty));
  const dUsed = used - prevUsed;
  const dWaste = waste - prevWaste;

  if (dUsed === 0 && dWaste === 0) {
    return { skipped: true, ledgerIds: [], stockApplied: false };
  }

  const consumeFromWarehouse = Boolean(
    opts.consumeFromWarehouse ?? usageRow.consumeFromWarehouse
  );
  const productId = usageRow.productId || null;
  const warehouseId = usageRow.warehouseId || null;
  const batchNumber = trimStr(usageRow.batchNumber) || null;
  const label =
    trimStr(usageRow.productName) ||
    trimStr(usageRow.inventoryType) ||
    'Usage item';
  const at = new Date().toISOString();
  const ledgerIds = [];

  const writeLedger = async ({ code, delta, reason }) => {
    if (!delta) return;
    const row = await LogisticsLedgerEntry.create({
      stockItemId: null,
      movementTypeCode: code,
      direction: delta < 0 ? 'OUT' : 'IN',
      quantityDelta: delta,
      warehouseId: warehouseId || null,
      locationId: null,
      fromWarehouseId: null,
      toWarehouseId: null,
      referenceType: 'USAGE',
      referenceId: String(usageRow._id),
      reasonCode: reason,
      remarks: `${reason} · ${label}${usageRow.campRequestId ? ` · camp ${usageRow.campRequestId}` : ''}`,
      actorId: actor?._id || null,
      actorEmail: actor?.email || null,
      at,
    });
    ledgerIds.push(row._id);
  };

  // Consumption reduces available quantity in ledger terms (negative delta).
  await writeLedger({
    code: dUsed >= 0 ? 'USAGE_USED' : 'USAGE_USED_REV',
    delta: -dUsed,
    reason: 'CONSUMPTION',
  });
  await writeLedger({
    code: dWaste >= 0 ? 'USAGE_WASTE' : 'USAGE_WASTE_REV',
    delta: -dWaste,
    reason: 'WASTAGE',
  });

  let stockApplied = false;
  const stockDelta = -(dUsed + dWaste);
  if (consumeFromWarehouse && stockDelta !== 0) {
    if (!productId || !warehouseId) {
      throw new AppError(
        'consumeFromWarehouse requires productId and warehouseId',
        400,
        'VALIDATION_ERROR'
      );
    }
    await applyWarehouseStockDelta({
      productId,
      warehouseId,
      batchNumber,
      name: label,
      quantityDelta: stockDelta,
      expiryDate: usageRow.expiryDate || '',
    });
    stockApplied = true;
  }

  usageRow.appliedUsedQty = used;
  usageRow.appliedWastageQty = waste;
  usageRow.usedQty = used;
  usageRow.screenCount = used;
  usageRow.wastage = waste;
  if (typeof usageRow.save === 'function') await usageRow.save();

  return { skipped: false, ledgerIds, stockApplied, dUsed, dWaste };
}

async function applyWarehouseStockDelta({
  productId,
  warehouseId,
  batchNumber,
  name,
  quantityDelta,
  expiryDate,
}) {
  const base = { isDeleted: false, warehouseId, productId };
  let stock = batchNumber
    ? await LogisticsStockItem.findOne({ ...base, batchNumber })
    : await LogisticsStockItem.findOne(base);
  if (!stock) {
    stock = await LogisticsStockItem.findOne({ ...base });
  }

  if (quantityDelta < 0) {
    const need = Math.abs(quantityDelta);
    if (!stock || (Number(stock.quantity) || 0) < need) {
      throw new AppError(
        `Insufficient warehouse stock for usage of “${name}” (need ${need})`,
        400,
        'INSUFFICIENT_STOCK'
      );
    }
    stock.quantity = (Number(stock.quantity) || 0) - need;
    await stock.save();
    return stock;
  }

  // Positive delta = reverse prior consumption
  if (stock) {
    stock.quantity = (Number(stock.quantity) || 0) + quantityDelta;
    await stock.save();
    return stock;
  }
  return LogisticsStockItem.create({
    name,
    productId,
    warehouseId,
    batchNumber,
    quantity: quantityDelta,
    status: 'Available',
    expiryDate: expiryDate || '',
    isActive: true,
  });
}

/** Soft-delete / cancel: reverse any applied ledger+stock effect. */
export async function reverseUsageInventoryEffect(usageRow, actor = null) {
  if (!usageRow) return { skipped: true };
  usageRow.screenCount = 0;
  usageRow.usedQty = 0;
  usageRow.wastage = 0;
  return applyUsageInventoryEffect(usageRow, actor, {
    consumeFromWarehouse: Boolean(usageRow.consumeFromWarehouse),
  });
}
