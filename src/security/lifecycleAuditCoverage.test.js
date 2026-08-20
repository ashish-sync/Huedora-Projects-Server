import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const movementRoutes = fs.readFileSync(path.join(root, 'modules/movements/movement.routes.js'), 'utf8');
const vendorBillRoutes = fs.readFileSync(path.join(root, 'modules/finance/vendorBill.routes.js'), 'utf8');

const REQUIRED_ACTIONS = [
  'MOVEMENT.REQUEST',
  'MOVEMENT.APPROVE',
  'MOVEMENT.REJECT',
  'MOVEMENT.SHIP',
  'MOVEMENT.RECEIVE',
  'MOVEMENT.CANCEL',
];

test('movement lifecycle audits cover every critical transition', () => {
  for (const action of REQUIRED_ACTIONS) {
    assert.match(movementRoutes, new RegExp(`action:\\s*'${action}'`));
  }
  assert.match(movementRoutes, /before,/);
  assert.match(movementRoutes, /requestId:\s*req\.requestId/);
});

test('vendor bill pay writes FINANCE.VENDOR_BILL.PAY audit', () => {
  assert.match(vendorBillRoutes, /FINANCE\.VENDOR_BILL\.PAY/);
  assert.match(vendorBillRoutes, /assertEntityNotStale/);
});
