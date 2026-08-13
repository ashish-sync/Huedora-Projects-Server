import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampFilter } from './campOps.helpers.js';
import { matchesExecutionFilter } from './campStageFilters.js';
import { EXECUTION_STATUS } from './campOps.lifecycle.js';
import { resolveExportColumns } from './campFullExport.js';
import { parseExportColumnKeys, parseExportFormat } from './campOps.export.js';

test('buildCampFilter scopes request stage lifecycle for pending review filters', () => {
  const filter = buildCampFilter({
    lifecycleStage: 'request',
    requestReviewStatus: 'review_pending',
  });

  assert.equal(filter.status, 'pending_review');
  assert.ok(filter.$and?.some((clause) => clause.$or?.some((part) => part.lifecycleStage === 'request')));
  assert.equal(filter.lifecycleStage, undefined);
});

test('buildCampFilter does not restrict lifecycle for request approved filter', () => {
  const filter = buildCampFilter({
    lifecycleStage: 'request',
    requestReviewStatus: 'request_approved',
  });

  assert.equal(filter.status, 'approved');
  assert.equal(filter.lifecycleStage, undefined);
  assert.equal(
    Boolean(filter.$and?.some((clause) => clause.$or?.some((part) => part.lifecycleStage === 'request'))),
    false,
  );
});

test('buildCampFilter does not restrict lifecycle for request rejected filter', () => {
  const filter = buildCampFilter({
    lifecycleStage: 'request',
    requestReviewStatus: 'request_rejected',
  });

  assert.equal(filter.status, 'rejected');
  assert.equal(filter.lifecycleStage, undefined);
});

test('buildCampFilter scopes hiring requested to assignment stage', () => {
  const filter = buildCampFilter({
    lifecycleStage: 'assignment',
    assignmentFilter: 'hiring_requested',
  });
  assert.equal(filter.status, 'approved');
  assert.equal(filter.lifecycleStage, 'assignment');
  assert.equal(filter.assignmentStatus, 'Hiring Requested');
});

test('buildCampFilter scopes assignment cancelled filters to financial stage', () => {
  const tylo = buildCampFilter({
    lifecycleStage: 'assignment',
    assignmentFilter: 'cancelled_by_tylo',
  });
  assert.equal(tylo.status, 'cancelled');
  assert.equal(tylo.lifecycleStage, 'financial');
  assert.ok(tylo.$and?.some((clause) => clause.$or?.some(
    (part) => part.assignmentRefusalReason === 'Cancelled by Tylo',
  )));
  assert.ok(tylo.$and?.some((clause) => clause.$or?.some(
    (part) => part.assignmentRefusalReason === 'Cancelled by TCPL',
  )));

  const legacy = buildCampFilter({
    lifecycleStage: 'assignment',
    assignmentFilter: 'cancelled_by_tcpl',
  });
  assert.equal(legacy.status, 'cancelled');
  assert.equal(legacy.lifecycleStage, 'financial');

  const client = buildCampFilter({
    lifecycleStage: 'assignment',
    assignmentFilter: 'cancelled_by_client',
  });
  assert.equal(client.status, 'cancelled');
  assert.equal(client.lifecycleStage, 'financial');
});

test('buildCampFilter maps financial cancel filters without payment status', () => {
  const tylo = buildCampFilter({
    lifecycleStage: 'financial',
    financialFilter: 'cancelled_by_tylo',
  });
  assert.equal(tylo.status, 'cancelled');
  assert.equal(tylo.lifecycleStage, 'financial');
  assert.equal(tylo.paymentSubmitStatus, undefined);
});

test('buildCampFilter maps financial stage filters to payment fields', () => {
  const pending = buildCampFilter({ lifecycleStage: 'financial', financialFilter: 'pending_review' });
  assert.equal(pending.paymentSubmitStatus, 'payment_not_checked');
  assert.equal(pending.lifecycleStage, 'financial');

  const verified = buildCampFilter({ lifecycleStage: 'financial', financialFilter: 'payment_verified' });
  assert.equal(verified.paymentSubmitStatus, 'payment_confirmed');
  assert.equal(verified.lifecycleStage, 'financial');

  const hold = buildCampFilter({ lifecycleStage: 'financial', financialFilter: 'payment_on_hold' });
  assert.equal(hold.paymentSubmitStatus, 'payment_hold');
  assert.equal(hold.lifecycleStage, 'financial');

  const completed = buildCampFilter({ lifecycleStage: 'financial', financialFilter: 'payment_completed' });
  assert.equal(completed.financePaymentStatus, 'paid');
  assert.equal(completed.lifecycleStage, 'financial');
});

test('buildCampFilter scopes execution stage lifecycle', () => {
  const filter = buildCampFilter({ lifecycleStage: 'execution' });
  assert.equal(filter.lifecycleStage, 'execution');
});

test('matchesExecutionFilter maps execution filter values to effective status', () => {
  const scheduled = {
    status: 'approved',
    lifecycleStage: 'execution',
    effectiveExecutionStatus: EXECUTION_STATUS.CAMP_SCHEDULED,
  };
  const ongoing = {
    status: 'approved',
    lifecycleStage: 'execution',
    effectiveExecutionStatus: EXECUTION_STATUS.CAMP_ONGOING,
  };
  const completed = {
    status: 'approved',
    lifecycleStage: 'execution',
    executionStatus: EXECUTION_STATUS.CAMP_COMPLETED,
  };
  const executed = {
    status: 'approved',
    lifecycleStage: 'execution',
    effectiveExecutionStatus: EXECUTION_STATUS.MARKED_EXECUTED,
  };
  const cancelledTylo = {
    status: 'cancelled',
    assignmentRefusalReason: 'Cancelled by Tylo',
  };
  const cancelledLegacyTcpl = {
    status: 'cancelled',
    assignmentRefusalReason: 'Cancelled by TCPL',
  };

  assert.equal(matchesExecutionFilter(scheduled, 'scheduled'), true);
  assert.equal(matchesExecutionFilter(scheduled, 'yet_to_start'), true);
  assert.equal(matchesExecutionFilter(ongoing, 'ongoing'), true);
  assert.equal(matchesExecutionFilter(completed, 'completed'), true);
  assert.equal(matchesExecutionFilter(executed, 'executed'), true);
  assert.equal(matchesExecutionFilter(cancelledTylo, 'cancelled_by_tylo'), true);
  assert.equal(matchesExecutionFilter(cancelledLegacyTcpl, 'cancelled_by_tylo'), true);
  assert.equal(matchesExecutionFilter(cancelledTylo, 'cancelled_by_tcpl'), true);
  assert.equal(matchesExecutionFilter(cancelledTylo, 'ongoing'), false);
});

test('resolveExportColumns keeps requested order and ignores unknown keys', () => {
  const columns = resolveExportColumns(['campId', 'unknown', 'clientName']);
  assert.deepEqual(columns.map((column) => column.key), ['campId', 'clientName']);
});

test('parseExportColumnKeys accepts arrays and comma-separated strings', () => {
  assert.deepEqual(parseExportColumnKeys('campId, clientName'), ['campId', 'clientName']);
  assert.deepEqual(parseExportColumnKeys(['campId']), ['campId']);
});

test('parseExportFormat normalizes csv and defaults to xlsx', () => {
  assert.equal(parseExportFormat('csv'), 'csv');
  assert.equal(parseExportFormat('XLSX'), 'xlsx');
  assert.equal(parseExportFormat(''), 'xlsx');
});

test('buildCampFilter excludes closed camps for same-day HCW schedule lookups', () => {
  const filter = buildCampFilter({
    hcwContactId: 'hcw-1',
    dateFrom: '2026-08-15',
    dateTo: '2026-08-15',
  });

  assert.deepEqual(filter.status, { $nin: ['cancelled', 'rejected'] });
  assert.deepEqual(filter.assignmentDecision, { $ne: 'refuse' });
  assert.equal(filter.hcwContactId, 'hcw-1');
});

test('buildCampFilter search matches key camp headers', () => {
  const filter = buildCampFilter({ search: 'Mumbai' });
  const fields = filter.$or.map((clause) => Object.keys(clause)[0]);
  assert.ok(fields.includes('clientName'));
  assert.ok(fields.includes('campaignType'));
  assert.ok(fields.includes('doctorName'));
  assert.ok(fields.includes('state'));
  assert.ok(fields.includes('city'));
  const campIdClause = filter.$or.find((c) => c.campId);
  assert.equal(campIdClause.campId.source, 'Mumbai');
  assert.equal(campIdClause.campId.flags, 'i');
});
