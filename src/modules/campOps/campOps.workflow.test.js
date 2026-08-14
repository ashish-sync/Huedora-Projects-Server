import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKFLOW_ACTIONS,
  assertWorkflowAction,
  applyAutoPlannedToExecuted,
  applyHoldTransition,
  applyReleaseHoldTransition,
  applyConfirmPaymentTransition,
  getMarkCompleteBlockers,
} from './campOps.workflow.js';
import { EXECUTION_STATUS } from './campOps.lifecycle.js';
import { preserveOrCaptureSubmissionTracking } from './campOps.helpers.js';

test('invalid Request → Financial is rejected', () => {
  assert.throws(
    () => assertWorkflowAction({
      lifecycleStage: 'request',
      status: 'pending_review',
    }, WORKFLOW_ACTIONS.MARK_COMPLETE),
    /Mark Complete is only allowed during Execution/,
  );
});

test('cancellation from Assignment is rejected', () => {
  assert.throws(
    () => assertWorkflowAction({
      lifecycleStage: 'assignment',
      status: 'approved',
    }, WORKFLOW_ACTIONS.CANCEL),
    /Cancellation is only permitted during Execution/,
  );
});

test('Planned → Executed auto when three inputs present', () => {
  const camp = {
    lifecycleStage: 'execution',
    executionStatus: EXECUTION_STATUS.CAMP_SCHEDULED,
    chargeableStatus: 'Chargeable',
    inTime: '09:00',
    attire: 'No Issues',
  };
  assert.equal(applyAutoPlannedToExecuted(camp), true);
  assert.equal(camp.executionStatus, EXECUTION_STATUS.MARKED_EXECUTED);
});

test('Mark Complete blockers include kms patients product count', () => {
  const blockers = getMarkCompleteBlockers({
    lifecycleStage: 'execution',
    executionStatus: EXECUTION_STATUS.MARKED_EXECUTED,
    chargeableStatus: 'Chargeable',
    inTime: '09:00',
    attire: 'No Issues',
    outTime: '12:00',
    executionDocuments: [
      { docType: 'doctor_form' },
      { docType: 'patient_form' },
    ],
  });
  assert.ok(blockers.some((b) => /Travelled Kms/i.test(b)));
  assert.ok(blockers.some((b) => /Patients Screened/i.test(b)));
  assert.ok(blockers.some((b) => /Product Count/i.test(b)));
});

test('Hold requires remark; release clears active remark', () => {
  const camp = {
    lifecycleStage: 'financial',
    status: 'executed',
    paymentSubmitStatus: 'payment_not_checked',
    financePaymentStatus: '',
  };
  assert.throws(() => applyHoldTransition(camp, ''), /Hold Remark is required/);
  applyHoldTransition(camp, 'Waiting for UTR');
  assert.equal(camp.paymentSubmitStatus, 'payment_hold');
  assert.equal(camp.paymentRemark, 'Waiting for UTR');
  applyReleaseHoldTransition(camp);
  assert.equal(camp.paymentSubmitStatus, 'payment_confirmed');
  assert.equal(camp.paymentRemark, '');
});

test('Confirm Payment from pending', () => {
  const camp = {
    lifecycleStage: 'financial',
    status: 'executed',
    paymentSubmitStatus: 'payment_not_checked',
  };
  applyConfirmPaymentTransition(camp);
  assert.equal(camp.paymentSubmitStatus, 'payment_confirmed');
});

test('preserveOrCaptureSubmissionTracking keeps original submittedAt', () => {
  const existing = {
    submittedAt: '2026-01-01T10:00:00.000Z',
    submittedOffHours: false,
    submittedWeekendAttention: false,
  };
  const next = preserveOrCaptureSubmissionTracking(existing);
  assert.equal(next.submittedAt, '2026-01-01T10:00:00.000Z');
});
