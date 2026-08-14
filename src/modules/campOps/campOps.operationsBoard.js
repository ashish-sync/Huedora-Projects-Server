/**
 * Camp One Operations Board — stage + status counts for Team Leader dashboards.
 * Uses the same Stage/Status vocabulary as Manage filters.
 */

import { normalizeLifecycleStage, resolveEffectiveExecutionStatus, EXECUTION_STATUS } from './campOps.lifecycle.js';
import { resolveRequestReviewStatus } from './campOps.requestReview.js';
import { matchesExecutionFilter } from './campStageFilters.js';

const REQUEST_STATUSES = [
  { value: 'review_pending', label: 'Review Pending', attention: true },
  { value: 'review_overdue', label: 'Review Overdue', attention: false },
  { value: 'request_rejected', label: 'Refused', attention: false },
  { value: 'information_requested', label: 'Info Requested', attention: false },
];

const ASSIGNMENT_STATUSES = [
  { value: 'unassigned', label: 'Unassigned', attention: true },
  { value: 'hiring_requested', label: 'Hiring Requested', attention: false },
];

const EXECUTION_STATUSES = [
  { value: 'planned', label: 'Planned', attention: true },
  { value: 'executed', label: 'Executed', attention: false },
  { value: 'cancelled_by_tylo', label: 'Cancelled by Tylo', attention: false },
  { value: 'cancelled_by_client', label: 'Cancelled by Client', attention: false },
];

const FINANCIAL_STATUSES = [
  { value: 'payment_not_checked', label: 'Pending Confirmation', attention: true },
  { value: 'payment_confirmed', label: 'Confirmed Payment', attention: false },
  { value: 'payment_hold', label: 'Hold', attention: false },
  { value: 'payment_done', label: 'Payment Done', attention: false },
];

export const OPERATIONS_BOARD_STAGES = [
  { id: 'request', label: 'Request', statuses: REQUEST_STATUSES },
  { id: 'assignment', label: 'Assignment', statuses: ASSIGNMENT_STATUSES },
  { id: 'execution', label: 'Execution', statuses: EXECUTION_STATUSES },
  { id: 'financial', label: 'Financial', statuses: FINANCIAL_STATUSES },
];

function isCancelledByTylo(camp = {}) {
  return matchesExecutionFilter(camp, 'cancelled_by_tylo');
}

function isCancelledByClient(camp = {}) {
  return matchesExecutionFilter(camp, 'cancelled_by_client');
}

/** Board stage partition — cancelled closures stay under Execution for ops visibility. */
export function resolveOperationsBoardStage(camp = {}) {
  if (isCancelledByTylo(camp) || isCancelledByClient(camp)) return 'execution';
  return normalizeLifecycleStage(camp.lifecycleStage, 'request');
}

export function resolveOperationsBoardStatus(camp = {}, stage = resolveOperationsBoardStage(camp), now = new Date()) {
  if (stage === 'request') {
    const resolved = resolveRequestReviewStatus(camp, now);
    if (resolved === 'request_rejected') return 'request_rejected';
    if (resolved === 'information_requested') return 'information_requested';
    if (resolved === 'review_overdue') return 'review_overdue';
    if (resolved === 'review_pending' || camp.status === 'pending_review') return 'review_pending';
    return '';
  }

  if (stage === 'assignment') {
    if (String(camp.assignmentStatus || '').trim() === 'Hiring Requested') return 'hiring_requested';
    return 'unassigned';
  }

  if (stage === 'execution') {
    if (isCancelledByTylo(camp)) return 'cancelled_by_tylo';
    if (isCancelledByClient(camp)) return 'cancelled_by_client';
    const effective = camp.effectiveExecutionStatus || resolveEffectiveExecutionStatus(camp);
    if (effective === EXECUTION_STATUS.MARKED_EXECUTED || effective === EXECUTION_STATUS.CAMP_COMPLETED) {
      return 'executed';
    }
    return 'planned';
  }

  if (stage === 'financial') {
    if (String(camp.financePaymentStatus || '').trim() === 'paid') return 'payment_done';
    const submit = String(camp.paymentSubmitStatus || '').trim();
    if (submit === 'payment_hold') return 'payment_hold';
    if (submit === 'payment_confirmed') return 'payment_confirmed';
    return 'payment_not_checked';
  }

  return '';
}

function emptyStatusCounts(statuses) {
  return Object.fromEntries(statuses.map((row) => [row.value, 0]));
}

export function buildOperationsBoard(camps = [], now = new Date()) {
  const stages = OPERATIONS_BOARD_STAGES.map((stage) => ({
    id: stage.id,
    label: stage.label,
    total: 0,
    statuses: stage.statuses.map((row) => ({ ...row, count: 0 })),
    byStatus: emptyStatusCounts(stage.statuses),
  }));
  const stageMap = Object.fromEntries(stages.map((stage) => [stage.id, stage]));

  let total = 0;
  for (const camp of camps) {
    total += 1;
    const stageId = resolveOperationsBoardStage(camp);
    const stage = stageMap[stageId];
    if (!stage) continue;
    stage.total += 1;
    const statusValue = resolveOperationsBoardStatus(camp, stageId, now);
    if (statusValue && Object.prototype.hasOwnProperty.call(stage.byStatus, statusValue)) {
      stage.byStatus[statusValue] += 1;
    }
  }

  for (const stage of stages) {
    stage.statuses = stage.statuses.map((row) => ({
      ...row,
      count: stage.byStatus[row.value] || 0,
    }));
  }

  return {
    total,
    stages,
    generatedAt: now.toISOString(),
  };
}
