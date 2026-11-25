import test from 'node:test';
import assert from 'node:assert/strict';
import { userCanDeleteRecords, userIsSuperAdmin } from './systemRole.js';

test('userIsSuperAdmin recognizes platform Super Admin systemRole', () => {
  assert.equal(userIsSuperAdmin({ systemRole: 'Super Admin' }), true);
  assert.equal(userIsSuperAdmin({ systemRole: 'super admin' }), true);
  assert.equal(userIsSuperAdmin({ systemRole: 'Admin' }), false);
  assert.equal(userIsSuperAdmin({ systemRole: 'User' }), false);
  assert.equal(userIsSuperAdmin({}), false);
});

test('userCanDeleteRecords allows platform Super Admin only', () => {
  assert.equal(userCanDeleteRecords({ systemRole: 'User' }, new Set(['*'])), false);
  assert.equal(userCanDeleteRecords({ systemRole: 'Admin' }, new Set(['*'])), false);
  assert.equal(userCanDeleteRecords({ systemRole: 'Super Admin' }, new Set(['agreements:write'])), true);
  assert.equal(userCanDeleteRecords({ systemRole: 'Super Admin' }, new Set(['*'])), true);
  assert.equal(userCanDeleteRecords({ systemRole: 'Admin' }, new Set(['agreements:write'])), false);
  assert.equal(userCanDeleteRecords({ systemRole: 'User' }, new Set(['agreements:write'])), false);
});
