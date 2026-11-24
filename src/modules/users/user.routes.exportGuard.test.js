import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { PERMISSIONS } from '../../config/constants.js';

test('roles export route requires Super Admin system role', () => {
  const src = fs.readFileSync(new URL('./user.routes.js', import.meta.url), 'utf8');
  assert.match(src, /\/roles\/export/);
  assert.match(src, /\/roles\/export[\s\S]{0,240}requireSuperAdmin/);
});

test('permission constants include finance SoD keys', () => {
  assert.equal(PERMISSIONS.FINANCE_VERIFY, 'finance:verify');
  assert.equal(PERMISSIONS.FINANCE_APPROVE, 'finance:approve');
  assert.equal(PERMISSIONS.FINANCE_PAY, 'finance:pay');
});
