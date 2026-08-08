import test from 'node:test';
import assert from 'node:assert/strict';
import { EXECUTION_STATUS } from './campOps.lifecycle.js';
import { matchesExecutionFilter } from './campStageFilters.js';

test('matches cancelled by Tylo camps', () => {
  assert.equal(matchesExecutionFilter({
    status: 'cancelled',
    assignmentRefusalReason: 'Cancelled by Tylo',
  }, 'cancelled_by_tylo'), true);
});

test('matches legacy cancelled by TCPL camps under Tylo filter', () => {
  assert.equal(matchesExecutionFilter({
    status: 'cancelled',
    assignmentRefusalReason: 'Cancelled by TCPL',
  }, 'cancelled_by_tylo'), true);
  assert.equal(matchesExecutionFilter({
    status: 'cancelled',
    assignmentRefusalReason: 'Cancelled by Tylo',
  }, 'cancelled_by_tcpl'), true);
});

test('matches camp completed execution status', () => {
  assert.equal(matchesExecutionFilter({
    status: 'approved',
    executionStatus: EXECUTION_STATUS.CAMP_COMPLETED,
  }, 'completed'), true);
});

test('matches effective execution status from camp time', () => {
  const camp = {
    status: 'approved',
    executionStatus: EXECUTION_STATUS.CAMP_SCHEDULED,
    campDate: '2099-01-01',
    startTime: '09:00',
    endTime: '12:00',
  };
  assert.equal(matchesExecutionFilter(camp, 'scheduled'), true);
  assert.equal(matchesExecutionFilter(camp, 'yet_to_start'), true);
  assert.equal(matchesExecutionFilter(camp, 'ongoing'), false);
});
