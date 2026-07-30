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
  assert.equal(filter.$and, undefined);
});

test('buildCampFilter does not restrict lifecycle for request rejected filter', () => {
  const filter = buildCampFilter({
    lifecycleStage: 'request',
    requestReviewStatus: 'request_rejected',
  });

  assert.equal(filter.status, 'rejected');
  assert.equal(filter.lifecycleStage, undefined);
});

test('buildCampFilter scopes assignment cancelled filters to assignment stage', () => {
  const tcpl = buildCampFilter({
    lifecycleStage: 'assignment',
    assignmentFilter: 'cancelled_by_tcpl',
  });
  assert.equal(tcpl.status, 'cancelled');
  assert.equal(tcpl.lifecycleStage, 'assignment');

  const client = buildCampFilter({
    lifecycleStage: 'assignment',
    assignmentFilter: 'cancelled_by_client',
  });
  assert.equal(client.status, 'cancelled');
  assert.equal(client.lifecycleStage, 'assignment');
});

test('buildCampFilter maps financial stage filters to payment fields', () => {
  assert.deepEqual(
    buildCampFilter({ lifecycleStage: 'financial', financialFilter: 'pending_review' }),
    { isDeleted: false, paymentSubmitStatus: 'payment_not_checked', lifecycleStage: 'financial' },
  );
  assert.deepEqual(
    buildCampFilter({ lifecycleStage: 'financial', financialFilter: 'payment_verified' }),
    { isDeleted: false, paymentSubmitStatus: 'payment_confirmed', lifecycleStage: 'financial' },
  );
  assert.deepEqual(
    buildCampFilter({ lifecycleStage: 'financial', financialFilter: 'payment_on_hold' }),
    { isDeleted: false, paymentSubmitStatus: 'payment_hold', lifecycleStage: 'financial' },
  );
  assert.deepEqual(
    buildCampFilter({ lifecycleStage: 'financial', financialFilter: 'payment_completed' }),
    { isDeleted: false, financePaymentStatus: 'paid', lifecycleStage: 'financial' },
  );
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
  const cancelledTcpl = {
    status: 'cancelled',
    assignmentRefusalReason: 'Cancelled by TCPL',
  };

  assert.equal(matchesExecutionFilter(scheduled, 'yet_to_start'), true);
  assert.equal(matchesExecutionFilter(ongoing, 'ongoing'), true);
  assert.equal(matchesExecutionFilter(completed, 'completed'), true);
  assert.equal(matchesExecutionFilter(executed, 'executed'), true);
  assert.equal(matchesExecutionFilter(cancelledTcpl, 'cancelled_by_tcpl'), true);
  assert.equal(matchesExecutionFilter(cancelledTcpl, 'ongoing'), false);
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
