import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canEditLifecycleStage,
  getExecutionFinanceBlockers,
  isCampExecutedForPayout,
  isExecutionCancellationForFinance,
  isExecutionReadyForFinance,
  lifecyclePayloadFromBody,
  resolveCancelledClosureExecutionStatus,
} from './campOps.lifecycle.js';

test('Camp Payout auto-pick is only for Executed execution status', () => {
  assert.equal(isCampExecutedForPayout({ executionStatus: 'Marked Executed' }), true);
  assert.equal(isCampExecutedForPayout({ executionStatus: 'Camp Completed' }), true);
  assert.equal(isCampExecutedForPayout({ executionStatus: 'Executed' }), true);
  assert.equal(isCampExecutedForPayout({ executionStatus: 'Camp Scheduled' }), false);
  assert.equal(isCampExecutedForPayout({ executionStatus: 'Cancelled by Tylo' }), false);
  assert.equal(isCampExecutedForPayout({ executionStatus: 'Cancelled by Client' }), false);
  assert.equal(
    isCampExecutedForPayout({ status: 'executed', executionStatus: 'Cancelled by Client' }),
    false,
  );
});

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
  assert.equal(canEditLifecycleStage(camp, 'request', { isAdmin: true }), true);
  assert.equal(canEditLifecycleStage(camp, 'assignment', { isAdmin: true }), true);
  assert.equal(canEditLifecycleStage(camp, 'execution', { isAdmin: true }), true);
});

test('Admin can edit Request/Assignment/Execution after Financial and Payment Done', () => {
  const camp = {
    status: 'executed',
    lifecycleStage: 'financial',
    financePaymentStatus: 'paid',
  };
  assert.equal(canEditLifecycleStage(camp, 'request'), false);
  assert.equal(canEditLifecycleStage(camp, 'assignment'), false);
  assert.equal(canEditLifecycleStage(camp, 'execution'), false);
  assert.equal(canEditLifecycleStage(camp, 'request', { isAdmin: true }), true);
  assert.equal(canEditLifecycleStage(camp, 'assignment', { isAdmin: true }), true);
  assert.equal(canEditLifecycleStage(camp, 'execution', { isAdmin: true }), true);
  assert.equal(canEditLifecycleStage(camp, 'financial', { isAdmin: true }), true);
});

test('legacy refused execution still blocks finance readiness', () => {
  const camp = { executionStatus: 'Refused' };
  assert.equal(isExecutionCancellationForFinance(camp), false);
  assert.ok(getExecutionFinanceBlockers(camp).length > 0);
});

test('complete execution with consumables zero is ready for auto Financial advance', () => {
  const mapped = [{ productId: 'p1', itemName: 'Test Strip' }];
  const camp = {
    executionStatus: 'Marked Executed',
    chargeableStatus: 'Chargeable',
    inTime: '09:00',
    attire: 'No Issues',
    outTime: '12:00',
    kmRoundTrip: 0,
    actualPatients: 10,
    rxCount: 0,
    executionDocuments: [
      { docType: 'doctor_form' },
      { docType: 'patient_form' },
    ],
    consumablesUsed: [{ productId: 'p1', quantityUsed: 0, wastage: 0 }],
  };
  assert.equal(isExecutionReadyForFinance(camp, mapped), true);
  assert.deepEqual(getExecutionFinanceBlockers(camp, mapped), []);
});

test('blank consumable usage blocks finance readiness even when other fields are complete', () => {
  const mapped = [{ productId: 'p1', itemName: 'Test Strip' }];
  const camp = {
    executionStatus: 'Marked Executed',
    chargeableStatus: 'Chargeable',
    inTime: '09:00',
    attire: 'No Issues',
    outTime: '12:00',
    kmRoundTrip: 5,
    actualPatients: 10,
    rxCount: 1,
    executionDocuments: [
      { docType: 'doctor_form' },
      { docType: 'patient_form' },
    ],
    consumablesUsed: [{ productId: 'p1', quantityUsed: '', wastage: '' }],
  };
  const blockers = getExecutionFinanceBlockers(camp, mapped);
  assert.ok(blockers.some((b) => /Test Strip/i.test(b) && /0 if none/i.test(b)));
  assert.equal(isExecutionReadyForFinance(camp, mapped), false);
});

test('Admin can persist an explicit Execution Status instead of auto Planned→Executed', () => {
  const auto = lifecyclePayloadFromBody(
    {
      executionStatus: 'Camp Scheduled',
      chargeableStatus: 'Chargeable',
      inTime: '09:00',
      attire: 'No Issues',
    },
    { executionStatus: 'Camp Scheduled' },
  );
  assert.equal(auto.executionStatus, 'Marked Executed');

  const explicit = lifecyclePayloadFromBody(
    {
      executionStatus: 'Camp Scheduled',
      chargeableStatus: 'Chargeable',
      inTime: '09:00',
      attire: 'No Issues',
    },
    { executionStatus: 'Camp Completed' },
    { allowExplicitExecutionStatus: true },
  );
  assert.equal(explicit.executionStatus, 'Camp Scheduled');

  const cancelled = lifecyclePayloadFromBody(
    { executionStatus: 'Cancelled by Tylo' },
    { executionStatus: 'Camp Completed' },
    { allowExplicitExecutionStatus: true },
  );
  assert.equal(cancelled.executionStatus, 'Cancelled by Tylo');
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
