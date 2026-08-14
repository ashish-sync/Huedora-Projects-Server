/**
 * Authoritative Camp One lifecycle workflow — Stage + Status + allowed actions.
 * Keep stored codes stable; map display labels to the finalized guide vocabulary.
 */

import { AppError } from '../../utils/helpers.js';
import {
  normalizeLifecycleStage,
  getMarkExecutedFieldBlockers,
  getExecutionFinanceBlockers,
  isExecutionCancellationForFinance,
  normalizeExecutionStatus,
  EXECUTION_STATUS,
  EXECUTION_CANCELLATION_STATUSES,
  normalizePaymentSubmitStatus,
  normalizeFinancePaymentStatus,
} from './campOps.lifecycle.js';

export const WORKFLOW_ACTIONS = {
  CONFIRM: 'confirm',
  REQUEST_INFO: 'request_info',
  REFUSE: 'refuse',
  REOPEN: 'reopen',
  ASSIGN: 'assign',
  HIRING_REQUESTED: 'hiring_requested',
  MARK_COMPLETE: 'mark_complete',
  CANCEL: 'cancel',
  CONFIRM_PAYMENT: 'confirm_payment',
  HOLD: 'hold',
  RELEASE_HOLD: 'release_hold',
  PAYMENT_DONE: 'payment_done',
};

export const EXECUTION_STATUS_LABELS = {
  [EXECUTION_STATUS.CAMP_SCHEDULED]: 'Planned',
  [EXECUTION_STATUS.CAMP_ONGOING]: 'Planned',
  [EXECUTION_STATUS.MARKED_EXECUTED]: 'Executed',
  [EXECUTION_STATUS.CAMP_COMPLETED]: 'Executed',
  'Cancelled by Tylo': 'Cancelled by Tylo',
  'Cancelled by Client': 'Cancelled by Client',
};

export const PAYMENT_SUBMIT_LABELS = {
  payment_not_checked: 'Pending Confirmation',
  '': 'Pending Confirmation',
  payment_confirmed: 'Confirmed Payment',
  payment_hold: 'Hold',
};

export const FINANCE_PAYMENT_LABELS = {
  paid: 'Payment Done',
};

export function executionStatusLabel(executionStatus) {
  const normalized = normalizeExecutionStatus(executionStatus);
  return EXECUTION_STATUS_LABELS[normalized] || normalized || '—';
}

export function paymentSubmitLabel(status) {
  const key = normalizePaymentSubmitStatus(status) || '';
  return PAYMENT_SUBMIT_LABELS[key] || PAYMENT_SUBMIT_LABELS[''] || '—';
}

export function financePaymentLabel(status) {
  const key = normalizeFinancePaymentStatus(status);
  if (key === 'paid') return 'Payment Done';
  return '';
}

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/** Resolve guide-facing assignment status (Pending → Unassigned). Assigned is an action, not a status. */
export function resolveAssignmentWorkflowStatus(camp = {}) {
  const raw = trim(camp.assignmentStatus);
  if (raw === 'Hiring Requested') return 'Hiring Requested';
  return 'Unassigned';
}

export function isFinancialPaymentDone(camp = {}) {
  return normalizeFinancePaymentStatus(camp.financePaymentStatus) === 'paid';
}

export function isCampInFinancialLifecycle(camp = {}) {
  return normalizeLifecycleStage(camp.lifecycleStage, 'request') === 'financial';
}

/**
 * True when Chargeable + In Time + Attire are present (Planned → Executed gate).
 */
export function hasPlannedToExecutedInputs(camp = {}) {
  return getMarkExecutedFieldBlockers(camp).length === 0;
}

/**
 * Auto-advance Execution Planned → Executed when the three required inputs exist.
 * Does not move to Financial (that is Mark Complete).
 */
export function applyAutoPlannedToExecuted(camp) {
  if (!camp) return false;
  const stage = normalizeLifecycleStage(camp.lifecycleStage, 'request');
  if (stage !== 'execution') return false;
  if (isExecutionCancellationForFinance(camp)) return false;
  const current = normalizeExecutionStatus(camp.executionStatus);
  if (
    current === EXECUTION_STATUS.CAMP_COMPLETED
    || EXECUTION_CANCELLATION_STATUSES.includes(current)
  ) {
    return false;
  }
  if (!hasPlannedToExecutedInputs(camp)) return false;
  if (current === EXECUTION_STATUS.MARKED_EXECUTED) return false;
  camp.executionStatus = EXECUTION_STATUS.MARKED_EXECUTED;
  return true;
}

export function getMarkCompleteBlockers(camp = {}, mappedConsumables = []) {
  if (isExecutionCancellationForFinance(camp)) return [];
  const blockers = [];
  const exec = normalizeExecutionStatus(camp.executionStatus);
  if (
    exec !== EXECUTION_STATUS.MARKED_EXECUTED
    && exec !== EXECUTION_STATUS.CAMP_COMPLETED
  ) {
    blockers.push('Complete Chargeable Status, In Time, and Attire before Mark Complete');
  }
  if (!trim(camp.chargeableStatus)) blockers.push('Select Chargeable Status');
  if (!trim(camp.inTime)) blockers.push('Enter In Time');
  if (!trim(camp.attire)) blockers.push('Select Attire');
  if (!trim(camp.outTime)) blockers.push('Enter Out Time');
  if (camp.kmRoundTrip === '' || camp.kmRoundTrip == null || Number.isNaN(Number(camp.kmRoundTrip))) {
    blockers.push('Enter Travelled Kms (Round Trip)');
  }
  const patients = camp.actualPatients ?? camp.patientsCount;
  if (patients === '' || patients == null || Number.isNaN(Number(patients))) {
    blockers.push('Enter Patients Screened');
  }
  if (camp.rxCount === '' || camp.rxCount == null || Number.isNaN(Number(camp.rxCount))) {
    blockers.push('Enter Product Count');
  }
  // Docs + consumables from existing finance blockers (without requiring Camp Completed first)
  const financeLike = getExecutionFinanceBlockers(
    {
      ...camp,
      executionStatus: EXECUTION_STATUS.CAMP_COMPLETED,
    },
    mappedConsumables,
  ).filter((b) => !String(b).includes('Camp Completed'));
  blockers.push(...financeLike);
  return [...new Set(blockers)];
}

export function assertMarkCompleteReady(camp = {}, mappedConsumables = []) {
  const blockers = getMarkCompleteBlockers(camp, mappedConsumables);
  if (blockers.length) {
    throw new AppError(blockers[0], 400, 'VALIDATION_ERROR');
  }
}

/**
 * Validate a workflow action against the current camp state.
 * @throws AppError on invalid transition
 */
export function assertWorkflowAction(camp, action, payload = {}) {
  const stage = normalizeLifecycleStage(camp?.lifecycleStage, 'request');
  const status = trim(camp?.status);
  const act = String(action || '').trim();

  if (isFinancialPaymentDone(camp) && act !== WORKFLOW_ACTIONS.PAYMENT_DONE) {
    // Admin corrections go through PUT with admin override; lifecycle actions stay blocked.
    if ([
      WORKFLOW_ACTIONS.CONFIRM,
      WORKFLOW_ACTIONS.ASSIGN,
      WORKFLOW_ACTIONS.MARK_COMPLETE,
      WORKFLOW_ACTIONS.CANCEL,
      WORKFLOW_ACTIONS.CONFIRM_PAYMENT,
      WORKFLOW_ACTIONS.HOLD,
      WORKFLOW_ACTIONS.RELEASE_HOLD,
      WORKFLOW_ACTIONS.REFUSE,
    ].includes(act)) {
      throw new AppError(
        'Payment Done camps cannot change lifecycle status',
        400,
        'WORKFLOW_LOCKED',
      );
    }
  }

  switch (act) {
    case WORKFLOW_ACTIONS.CONFIRM: {
      if (status !== 'pending_review' || stage !== 'request') {
        throw new AppError('Only Request camps under review can be confirmed', 400, 'INVALID_TRANSITION');
      }
      return;
    }
    case WORKFLOW_ACTIONS.REQUEST_INFO: {
      if (status !== 'pending_review' || stage !== 'request') {
        throw new AppError('Information can only be requested during Request review', 400, 'INVALID_TRANSITION');
      }
      return;
    }
    case WORKFLOW_ACTIONS.REFUSE: {
      if (!['request', 'assignment'].includes(stage)) {
        throw new AppError('Refuse is only allowed during Request or Assignment', 400, 'INVALID_TRANSITION');
      }
      if (['cancelled', 'rejected', 'executed'].includes(status) && stage === 'execution') {
        throw new AppError('Cannot refuse after Execution', 400, 'INVALID_TRANSITION');
      }
      return;
    }
    case WORKFLOW_ACTIONS.REOPEN: {
      if (status !== 'rejected') {
        throw new AppError('Only refused camps can be reopened', 400, 'INVALID_TRANSITION');
      }
      return;
    }
    case WORKFLOW_ACTIONS.ASSIGN: {
      if (stage !== 'assignment' || status !== 'approved') {
        throw new AppError('Assign is only allowed during Assignment', 400, 'INVALID_TRANSITION');
      }
      return;
    }
    case WORKFLOW_ACTIONS.HIRING_REQUESTED: {
      if (stage !== 'assignment' || status !== 'approved') {
        throw new AppError('Hiring Requested is only allowed during Assignment', 400, 'INVALID_TRANSITION');
      }
      return;
    }
    case WORKFLOW_ACTIONS.CANCEL: {
      if (stage !== 'execution') {
        throw new AppError('Cancellation is only permitted during Execution', 400, 'INVALID_TRANSITION');
      }
      if (['cancelled', 'rejected'].includes(status)) {
        throw new AppError('Camp is already closed', 400, 'INVALID_TRANSITION');
      }
      if (stage === 'financial' || isCampInFinancialLifecycle(camp)) {
        // Allow cancel only while still on execution stage
      }
      const exec = normalizeExecutionStatus(camp.executionStatus);
      if (exec === EXECUTION_STATUS.CAMP_COMPLETED) {
        throw new AppError('Cannot cancel after Mark Complete', 400, 'INVALID_TRANSITION');
      }
      return;
    }
    case WORKFLOW_ACTIONS.MARK_COMPLETE: {
      if (stage !== 'execution') {
        throw new AppError('Mark Complete is only allowed during Execution', 400, 'INVALID_TRANSITION');
      }
      if (isExecutionCancellationForFinance(camp)) {
        throw new AppError('Cancelled camps move to Financial via cancellation, not Mark Complete', 400, 'INVALID_TRANSITION');
      }
      return;
    }
    case WORKFLOW_ACTIONS.CONFIRM_PAYMENT: {
      if (stage !== 'financial') {
        throw new AppError('Confirm Payment is only allowed in Financial', 400, 'INVALID_TRANSITION');
      }
      if (isFinancialPaymentDone(camp)) {
        throw new AppError('Payment is already done', 400, 'INVALID_TRANSITION');
      }
      const submit = normalizePaymentSubmitStatus(camp.paymentSubmitStatus) || 'payment_not_checked';
      if (submit === 'payment_hold') {
        throw new AppError('Release Hold before confirming payment, or use Release Hold', 400, 'INVALID_TRANSITION');
      }
      return;
    }
    case WORKFLOW_ACTIONS.HOLD: {
      if (stage !== 'financial') {
        throw new AppError('Hold is only allowed in Financial', 400, 'INVALID_TRANSITION');
      }
      if (isFinancialPaymentDone(camp)) {
        throw new AppError('Payment Done camps cannot be put on Hold', 400, 'INVALID_TRANSITION');
      }
      if (!trim(payload.paymentRemark || payload.holdRemark)) {
        throw new AppError('Hold Remark is required', 400, 'VALIDATION_ERROR');
      }
      return;
    }
    case WORKFLOW_ACTIONS.RELEASE_HOLD: {
      if (stage !== 'financial') {
        throw new AppError('Release Hold is only allowed in Financial', 400, 'INVALID_TRANSITION');
      }
      if (normalizePaymentSubmitStatus(camp.paymentSubmitStatus) !== 'payment_hold') {
        throw new AppError('Camp is not on Hold', 400, 'INVALID_TRANSITION');
      }
      return;
    }
    case WORKFLOW_ACTIONS.PAYMENT_DONE: {
      if (stage !== 'financial') {
        throw new AppError('Payment Done is only allowed in Financial', 400, 'INVALID_TRANSITION');
      }
      const submit = normalizePaymentSubmitStatus(camp.paymentSubmitStatus);
      if (submit !== 'payment_confirmed' && !isFinancialPaymentDone(camp)) {
        // Allow sync when already confirmed, or idempotent re-apply when paid
        throw new AppError(
          'Payment Done requires Confirmed Payment first',
          400,
          'INVALID_TRANSITION',
        );
      }
      if (!trim(payload.transactionId || camp.transactionId)) {
        throw new AppError('UTR / Transaction ID is required for Payment Done', 400, 'VALIDATION_ERROR');
      }
      if (!trim(payload.paymentDate || camp.financeProcessedAt || payload.financeProcessedAt)) {
        // financeProcessedAt set by Finance One counts as payment date
        if (!trim(camp.financeProcessedAt) && !trim(payload.paidAt)) {
          throw new AppError('Payment Date is required for Payment Done', 400, 'VALIDATION_ERROR');
        }
      }
      return;
    }
    default:
      throw new AppError(`Unknown workflow action: ${act}`, 400, 'INVALID_TRANSITION');
  }
}

/** Apply Confirm → Assignment / Unassigned */
export function applyConfirmTransition(camp) {
  assertWorkflowAction(camp, WORKFLOW_ACTIONS.CONFIRM);
  camp.status = 'approved';
  camp.lifecycleStage = 'assignment';
  camp.assignmentStatus = 'Unassigned';
  camp.requestReviewStatus = 'request_approved';
}

/** Apply Mark Complete → Financial / Pending Confirmation */
export function applyMarkCompleteTransition(camp, mappedConsumables = []) {
  assertWorkflowAction(camp, WORKFLOW_ACTIONS.MARK_COMPLETE);
  assertMarkCompleteReady(camp, mappedConsumables);
  camp.executionStatus = EXECUTION_STATUS.CAMP_COMPLETED;
  camp.lifecycleStage = 'financial';
  camp.status = 'executed';
  camp.paymentSubmitStatus = camp.paymentSubmitStatus || 'payment_not_checked';
}

export function applyConfirmPaymentTransition(camp) {
  assertWorkflowAction(camp, WORKFLOW_ACTIONS.CONFIRM_PAYMENT);
  camp.paymentSubmitStatus = 'payment_confirmed';
}

export function applyHoldTransition(camp, remark) {
  assertWorkflowAction(camp, WORKFLOW_ACTIONS.HOLD, { paymentRemark: remark });
  camp.paymentSubmitStatus = 'payment_hold';
  camp.paymentRemark = trim(remark);
}

export function applyReleaseHoldTransition(camp) {
  assertWorkflowAction(camp, WORKFLOW_ACTIONS.RELEASE_HOLD);
  camp.paymentSubmitStatus = 'payment_confirmed';
  camp.paymentRemark = '';
}

/**
 * Financial visit/edit: only after lifecycle is financial (post Mark Complete / cancel).
 */
export function canVisitFinancialStage(campOrReachedStage) {
  if (campOrReachedStage && typeof campOrReachedStage === 'object') {
    return normalizeLifecycleStage(campOrReachedStage.lifecycleStage, 'request') === 'financial';
  }
  return normalizeLifecycleStage(campOrReachedStage, '') === 'financial';
}
