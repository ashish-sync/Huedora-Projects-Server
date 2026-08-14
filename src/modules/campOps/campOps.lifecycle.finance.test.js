import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canEditLifecycleStage,
  getExecutionFinanceBlockers,
  isExecutionCancellationForFinance,
  isExecutionReadyForFinance,
  lifecyclePayloadFromBody,
  resolveCancelledClosureExecutionStatus,
} from './campOps.lifecycle.js';

test('cancelled-by closure camps skip execution finance blockers', () => {
  const camp = {
    executionStatus: 'Cancelled by Tylo',
    status: 'cancelled',
    lifecycleStage: 'financial',
  };
  assert.equal(isExecutionCancellationForFinance(camp), true);
  assert.deepEqual(getExecutionFinanceBlockers(camp), []);
  assert.equal(isExecutionReadyForFinance(camp), true);
});

test('legacy cancelled camps match closure from assignment refusal reason', () => {
  const camp = {
    status: 'cancelled',
    lifecycleStage: 'execution',
    assignmentRefusalReason: 'Cancelled by Tylo',
    executionStatus: 'Ongoing',
  };
  assert.equal(isExecutionCancellationForFinance(camp), true);
  assert.equal(resolveCancelledClosureExecutionStatus(camp), 'Cancelled by Tylo');
  assert.deepEqual(getExecutionFinanceBlockers(camp), []);
  assert.equal(canEditLifecycleStage(camp, 'financial'), true);
});

test('cancelled camps can edit financial stage only', () => {
  const camp = {
    status: 'cancelled',
    lifecycleStage: 'financial',
    executionStatus: 'Cancelled by Client',
  };
  assert.equal(canEditLifecycleStage(camp, 'financial'), true);
  assert.equal(canEditLifecycleStage(camp, 'execution'), false);
  assert.equal(canEditLifecycleStage(camp, 'assignment'), false);
});

test('legacy refused execution still blocks finance readiness', () => {
  const camp = { executionStatus: 'Refused' };
  assert.equal(isExecutionCancellationForFinance(camp), false);
  assert.ok(getExecutionFinanceBlockers(camp).length > 0);
});

test('Camp PUT cannot set or reverse Payment Done (Finance One only)', () => {
  const unpaid = lifecyclePayloadFromBody(
    { financePaymentStatus: 'paid' },
    { financePaymentStatus: 'under_review' },
  );
  assert.notEqual(unpaid.financePaymentStatus, 'paid');

  const paid = lifecyclePayloadFromBody(
    { financePaymentStatus: 'not_paid' },
    { financePaymentStatus: 'paid' },
  );
  assert.equal(paid.financePaymentStatus, 'paid');
});
