import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOperationsBoard,
  resolveOperationsBoardStage,
  resolveOperationsBoardStatus,
} from './campOps.operationsBoard.js';

test('operations board partitions cancelled camps under Execution', () => {
  assert.equal(
    resolveOperationsBoardStage({
      status: 'cancelled',
      lifecycleStage: 'financial',
      executionStatus: 'Cancelled by Tylo',
    }),
    'execution',
  );
  assert.equal(
    resolveOperationsBoardStatus({
      status: 'cancelled',
      lifecycleStage: 'financial',
      executionStatus: 'Cancelled by Client',
    }, 'execution'),
    'cancelled_by_client',
  );
});

test('buildOperationsBoard totals match reference shape', () => {
  const board = buildOperationsBoard([
    { status: 'pending_review', lifecycleStage: 'request', requestReviewStatus: 'review_pending', submittedAt: new Date().toISOString() },
    { status: 'pending_review', lifecycleStage: 'request', requestIncomplete: true },
    { status: 'rejected', lifecycleStage: 'request' },
    { status: 'approved', lifecycleStage: 'assignment', assignmentStatus: 'Pending' },
    { status: 'approved', lifecycleStage: 'assignment', assignmentStatus: 'Hiring Requested' },
    {
      status: 'approved',
      lifecycleStage: 'execution',
      executionStatus: 'Camp Scheduled',
      campDate: '2099-01-01',
      startTime: '09:00',
      endTime: '12:00',
    },
    {
      status: 'executed',
      lifecycleStage: 'execution',
      executionStatus: 'Marked Executed',
      chargeableStatus: 'Chargeable',
      inTime: '09:00',
      attire: 'No Issues',
    },
    {
      status: 'cancelled',
      lifecycleStage: 'financial',
      executionStatus: 'Cancelled by Tylo',
    },
    {
      status: 'executed',
      lifecycleStage: 'financial',
      paymentSubmitStatus: 'payment_not_checked',
    },
    {
      status: 'executed',
      lifecycleStage: 'financial',
      paymentSubmitStatus: 'payment_confirmed',
    },
    {
      status: 'executed',
      lifecycleStage: 'financial',
      financePaymentStatus: 'paid',
    },
  ]);

  assert.equal(board.total, 11);
  const byId = Object.fromEntries(board.stages.map((s) => [s.id, s]));
  assert.equal(byId.request.total, 3);
  assert.equal(byId.assignment.total, 2);
  assert.equal(byId.execution.total, 3); // planned + executed + cancelled tylo
  assert.equal(byId.financial.total, 3);
  assert.equal(byId.financial.byStatus.payment_done, 1);
  assert.equal(byId.execution.byStatus.cancelled_by_tylo, 1);
});

test('Camp Completed is board-counted under Financial, Executed matches Manage filter', () => {
  const completed = {
    status: 'executed',
    lifecycleStage: 'execution',
    executionStatus: 'Camp Completed',
  };
  assert.equal(resolveOperationsBoardStage(completed), 'financial');
  assert.equal(resolveOperationsBoardStatus(completed), 'payment_not_checked');
  assert.equal(
    resolveOperationsBoardStatus({
      status: 'approved',
      lifecycleStage: 'execution',
      executionStatus: 'Marked Executed',
    }, 'execution'),
    'executed',
  );
});

test('operations board counts each Camp ID once across stages', () => {
  const board = buildOperationsBoard([
    {
      campId: 'CAMP-1',
      status: 'approved',
      lifecycleStage: 'assignment',
      assignmentStatus: 'Unassigned',
    },
    {
      campId: 'CAMP-1',
      status: 'approved',
      lifecycleStage: 'assignment',
      assignmentStatus: 'Unassigned',
    },
    {
      campId: 'CAMP-2',
      status: 'approved',
      lifecycleStage: 'assignment',
      assignmentStatus: 'Hiring Requested',
    },
  ]);
  assert.equal(board.total, 2);
  const assignment = board.stages.find((stage) => stage.id === 'assignment');
  assert.equal(assignment.total, 2);
  assert.equal(assignment.byStatus.unassigned, 1);
  assert.equal(assignment.byStatus.hiring_requested, 1);
});

test('operations board counts stored review_pending as overdue after the SLA', () => {
  const now = new Date(2026, 7, 10, 16, 0, 0, 0); // Mon 16:00
  const board = buildOperationsBoard([
    {
      status: 'pending_review',
      lifecycleStage: 'request',
      requestReviewStatus: 'review_pending',
      requestIncomplete: false,
      submittedAt: new Date(2026, 7, 10, 9, 0, 0, 0).toISOString(),
    },
    {
      status: 'pending_review',
      lifecycleStage: 'request',
      requestReviewStatus: 'review_pending',
      requestIncomplete: false,
      submittedAt: new Date(2026, 7, 10, 12, 0, 0, 0).toISOString(),
    },
  ], now);
  const request = board.stages.find((s) => s.id === 'request');
  assert.equal(request.byStatus.review_overdue, 1);
  assert.equal(request.byStatus.review_pending, 1);
});
