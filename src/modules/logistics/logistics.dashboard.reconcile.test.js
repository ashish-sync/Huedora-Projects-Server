import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard } from './logistics.dashboard.js';

test('dashboard KPIs reconcile with inward/outward/usage source rows', () => {
  const ledger = [
    {
      entryType: 'Inward',
      qty: 100,
      perUnitCost: 10,
      productType: 'Consumable',
      transactionDate: '2026-01-15',
    },
    {
      entryType: 'Outward',
      qty: 40,
      perUnitCost: 10,
      productType: 'Consumable',
      transactionDate: '2026-01-16',
      empId: 'H1',
      employeeName: 'HCW',
    },
    {
      entryType: 'Return',
      qty: 5,
      perUnitCost: 10,
      productType: 'Consumable',
      transactionDate: '2026-01-17',
      empId: 'H1',
    },
  ];
  const usage = [
    {
      inventoryType: 'Consumable',
      screenCount: 20,
      wastage: 3,
      perUnitCost: 10,
      campDate: '2026-01-18',
      hcwId: 'H1',
    },
  ];
  const dash = buildDashboard(ledger, usage, {});
  // Domain rule: Return is both a return and an inward (stock back to warehouse).
  assert.equal(dash.kpis.inwardQty, 105);
  assert.equal(dash.kpis.outwardQty, 40);
  assert.equal(dash.kpis.returnQty, 5);
  assert.equal(dash.kpis.balanceQty, 65);
  assert.equal(dash.kpis.usedQty, 20);
  assert.equal(dash.kpis.wastageQty, 3);
  assert.equal(dash.kpis.fieldBalanceQty, 12);
});
