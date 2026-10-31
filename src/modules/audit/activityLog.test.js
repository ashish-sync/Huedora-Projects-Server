import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyActivityLogFilters,
  describeActivity,
  normalizeActivityResult,
  resolveActivityModule,
} from './activityLog.js';

test('resolveActivityModule maps camp and finance codes to business modules', () => {
  assert.equal(resolveActivityModule('camp_ops.approve', 'camp_ops_camp').id, 'camp-one');
  assert.equal(resolveActivityModule('FINANCE.EXPENSE.CREATE', 'finance_expense').id, 'finance-one');
  assert.equal(resolveActivityModule('USER.LOGIN_SUCCESS', '').id, 'sign-in');
});

test('describeActivity writes a manager sentence instead of the event code', () => {
  const described = describeActivity({
    action: 'camp_ops.approve',
    entityType: 'camp_ops_camp',
    actorEmail: 'priya@tylo.test',
    result: 'SUCCESS',
    after: { campId: '26-10-0042', clientName: 'Acme' },
  });
  assert.equal(described.moduleLabel, 'Camp One');
  assert.equal(described.title, 'Approved a camp');
  assert.equal(described.status, 'Completed');
  assert.match(described.summary, /priya@tylo.test/i);
  assert.match(described.summary, /26-10-0042/);
  assert.doesNotMatch(described.summary, /camp_ops\.approve/);
});

test('describeActivity marks failed sign-in clearly', () => {
  const described = describeActivity({
    action: 'USER.LOGIN_FAILURE',
    actorEmail: 'rahul@tylo.test',
    result: 'FAILURE',
  });
  assert.equal(described.status, 'Failed');
  assert.match(described.summary, /did not complete/);
});

test('applyActivityLogFilters keeps existing API fields and adds optional business filters', () => {
  const filter = { action: /camp/i };
  applyActivityLogFilters(filter, {
    status: 'completed',
    employee: 'priya@tylo.test',
    module: 'camp-one',
  });
  assert.equal(filter.result, 'SUCCESS');
  assert.equal(filter.actorEmail instanceof RegExp, true);
  assert.equal(Array.isArray(filter.$and), true);
  assert.equal(normalizeActivityResult('failed'), 'FAILURE');
});
