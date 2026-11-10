import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyActivityLogFilters,
  applyDefaultActivityWindow,
  applyProgrammeScopeFilter,
  applyRoutineExclusion,
  describeActivity,
  isRoutineActivityAction,
  normalizeActivityResult,
  resolveActivityModule,
  resolveActivitySeverity,
  resolveActivitySource,
  resolveActivityType,
  slimActivityListRow,
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

test('applyDefaultActivityWindow bounds unfiltered reads to 30 days', () => {
  const now = new Date('2026-11-01T12:00:00.000Z');
  const filter = applyDefaultActivityWindow({}, {}, now);
  assert.equal(filter.at.$lte.toISOString(), '2026-11-01T12:00:00.000Z');
  assert.equal(filter.at.$gte.toISOString(), '2026-10-03T00:00:00.000Z');
});

test('applyDefaultActivityWindow keeps an explicit date range', () => {
  const filter = { at: { $gte: new Date('2026-01-01') } };
  applyDefaultActivityWindow(filter, { from: '2026-01-01' });
  assert.equal(filter.at.$gte.toISOString().startsWith('2026-01-01'), true);
  assert.equal(filter.at.$lte, undefined);
});

test('slimActivityListRow drops fat snapshots and keeps a subject', () => {
  const slim = slimActivityListRow({
    _id: 'a1',
    at: '2026-10-31T06:12:00.000Z',
    actorEmail: 'priya@tylo.test',
    action: 'camp_ops.approve',
    result: 'SUCCESS',
    before: { huge: 'x'.repeat(5000), campId: 'old' },
    after: { campId: '26-10-0042', clientName: 'Acme', builderForm: { pages: 40 } },
  });
  assert.equal(slim.after.campId, '26-10-0042');
  assert.equal(slim.after.builderForm, undefined);
  assert.equal(slim.before, undefined);
  assert.equal(slim.module, 'camp-one');
  assert.equal(slim.severity, 'important');
  assert.equal(slim.source, 'API');
  assert.equal(slim.activityType, 'approval');
});

test('resolveActivitySeverity and source classify sensitive and automation events', () => {
  assert.equal(resolveActivitySeverity('ROLE.DELETE'), 'critical');
  assert.equal(resolveActivitySeverity('camp_ops.approve'), 'important');
  assert.equal(resolveActivitySeverity('CONTACT.CREATE'), 'informational');
  assert.equal(resolveActivitySource({ action: 'IMPORT.COMMIT' }), 'Import');
  assert.equal(resolveActivitySource({ actorType: 'SYSTEM', action: 'RM.ASSET_CHANGE' }), 'Automation');
  assert.equal(resolveActivityType('LogisticsInOutEntry.CREATE'), 'stock');
  assert.equal(isRoutineActivityAction('USER.LOGIN_SUCCESS'), true);
  assert.equal(isRoutineActivityAction('camp_ops.approve'), false);
});

test('applyRoutineExclusion hides sign-in noise unless includeRoutine is set', () => {
  const filtered = applyRoutineExclusion({}, {});
  assert.equal(Array.isArray(filtered.$and), true);
  const kept = applyRoutineExclusion({}, { includeRoutine: '1' });
  assert.equal(kept.$and, undefined);
});

test('applyActivityLogFilters accepts severity source activityType and programmeId', () => {
  const filter = {};
  applyActivityLogFilters(filter, {
    severity: 'critical',
    source: 'UI',
    activityType: 'finance',
    programmeId: 'Oncology',
  });
  assert.equal(filter.severity, 'critical');
  assert.equal(filter.source, 'UI');
  assert.equal(filter.activityType, 'finance');
  assert.equal(filter.programmeId, 'Oncology');
});

test('applyProgrammeScopeFilter constrains programme-scoped readers', () => {
  const empty = applyProgrammeScopeFilter({}, []);
  assert.deepEqual(empty.programmeId, { $in: [] });
  const scoped = applyProgrammeScopeFilter({}, ['Oncology', 'Cardiology']);
  assert.equal(Array.isArray(scoped.$and), true);
});

test('describeActivity surfaces severity source and type', () => {
  const described = describeActivity({
    action: 'FINANCE.CLIENT_INVOICE.ISSUE',
    entityType: 'FinanceCommercialDocument',
    actorEmail: 'finance@tylo.test',
    result: 'SUCCESS',
    severity: 'critical',
    source: 'UI',
    activityType: 'finance',
    reason: 'Month-end billing',
  });
  assert.equal(described.severity, 'critical');
  assert.equal(described.source, 'UI');
  assert.equal(described.activityType, 'finance');
  assert.equal(described.moduleLabel, 'Finance One');
});
