import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { configurePersistence, loadCollection } from '../../store/persistence.js';
import { LogisticsUsageEntry, LogisticsStockItem, LogisticsLedgerEntry } from './logistics.model.js';
import { applyUsageInventoryEffect } from './logistics.usageInventory.js';

function tempPersist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-usage-inv-'));
  configurePersistence({ backend: 'file', dataDirectory: dir });
  return dir;
}

test('usage posts ledger for used+wastage and is idempotent on retry', async () => {
  tempPersist();
  const row = await LogisticsUsageEntry.create({
    productName: 'Lipid Strips',
    inventoryType: 'Lipid Strips',
    screenCount: 10,
    usedQty: 10,
    wastage: 2,
    appliedUsedQty: 0,
    appliedWastageQty: 0,
    consumeFromWarehouse: false,
  });

  const first = await applyUsageInventoryEffect(row, { _id: 'u1', email: 'a@b.c' });
  assert.equal(first.skipped, false);
  assert.equal(first.dUsed, 10);
  assert.equal(first.dWaste, 2);
  assert.equal(first.stockApplied, false);

  const ledger = await loadCollection('logistics_ledger_entries');
  const usageLines = ledger.filter((l) => String(l.referenceId) === String(row._id));
  assert.equal(usageLines.length, 2);
  assert.ok(usageLines.some((l) => l.movementTypeCode === 'USAGE_USED' && l.quantityDelta === -10));
  assert.ok(usageLines.some((l) => l.movementTypeCode === 'USAGE_WASTE' && l.quantityDelta === -2));

  const second = await applyUsageInventoryEffect(row, { _id: 'u1', email: 'a@b.c' });
  assert.equal(second.skipped, true);
  const ledger2 = await loadCollection('logistics_ledger_entries');
  assert.equal(
    ledger2.filter((l) => String(l.referenceId) === String(row._id)).length,
    2,
    'retry must not double-post'
  );
});

test('usage edit posts only the delta', async () => {
  tempPersist();
  const row = await LogisticsUsageEntry.create({
    productName: 'BNP',
    screenCount: 5,
    wastage: 0,
    appliedUsedQty: 0,
    appliedWastageQty: 0,
  });
  await applyUsageInventoryEffect(row, null);
  row.screenCount = 8;
  row.wastage = 1;
  await row.save();
  const delta = await applyUsageInventoryEffect(row, null);
  assert.equal(delta.dUsed, 3);
  assert.equal(delta.dWaste, 1);

  const ledger = await loadCollection('logistics_ledger_entries');
  const lines = ledger.filter((l) => String(l.referenceId) === String(row._id));
  // first apply: USAGE_USED only (wastage 0); second: USAGE_USED delta + USAGE_WASTE
  assert.equal(lines.length, 3);
});

test('consumeFromWarehouse reduces stock and blocks insufficient qty', async () => {
  tempPersist();
  await LogisticsStockItem.create({
    _id: 'stock1',
    name: 'Kit',
    productId: 'p1',
    warehouseId: 'w1',
    quantity: 5,
    status: 'Available',
    isDeleted: false,
  });

  const row = await LogisticsUsageEntry.create({
    productName: 'Kit',
    productId: 'p1',
    warehouseId: 'w1',
    screenCount: 3,
    wastage: 1,
    consumeFromWarehouse: true,
    appliedUsedQty: 0,
    appliedWastageQty: 0,
  });
  const ok = await applyUsageInventoryEffect(row, null);
  assert.equal(ok.stockApplied, true);
  const stock = await LogisticsStockItem.findOne({ _id: 'stock1' });
  assert.equal(Number(stock.quantity), 1);

  row.screenCount = 10;
  row.wastage = 1;
  await row.save();
  await assert.rejects(
    () => applyUsageInventoryEffect(row, null),
    (err) => err.code === 'INSUFFICIENT_STOCK'
  );
});
