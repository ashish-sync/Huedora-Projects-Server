import {
  EXECUTION_STATUS,
  normalizeExecutionStatus,
  resolveEffectiveExecutionStatus,
} from './campOps.lifecycle.js';

const CANCELLED_BY_TYLO_REASONS = new Set([
  'Cancelled by Tylo',
  'Cancelled by TCPL',
]);

function isCancelledByTylo(camp = {}) {
  const executionStatus = normalizeExecutionStatus(camp.executionStatus);
  return camp.status === 'cancelled' && (
    CANCELLED_BY_TYLO_REASONS.has(camp.assignmentRefusalReason)
    || executionStatus === 'Cancelled by Tylo'
    || camp.cancelledBy === 'khw'
  );
}

function isCancelledByClient(camp = {}) {
  const executionStatus = normalizeExecutionStatus(camp.executionStatus);
  return camp.status === 'cancelled' && (
    camp.assignmentRefusalReason === 'Cancelled by Client'
    || executionStatus === 'Cancelled by Client'
    || camp.cancelledBy === 'brand'
  );
}

export function matchesExecutionFilter(camp = {}, filter = '') {
  const value = String(filter || '').trim();
  if (!value) return true;

  if (value === 'cancelled_by_tylo' || value === 'cancelled_by_tcpl') {
    return isCancelledByTylo(camp);
  }
  if (value === 'cancelled_by_client') return isCancelledByClient(camp);
  if (value === 'completed') {
    return normalizeExecutionStatus(camp.executionStatus) === EXECUTION_STATUS.CAMP_COMPLETED;
  }

  if (['cancelled', 'rejected'].includes(camp.status)) return false;

  const effective = camp.effectiveExecutionStatus || resolveEffectiveExecutionStatus(camp);
  if (value === 'scheduled' || value === 'yet_to_start') {
    return effective === EXECUTION_STATUS.CAMP_SCHEDULED;
  }
  if (value === 'ongoing') return effective === EXECUTION_STATUS.CAMP_ONGOING;
  if (value === 'executed') return effective === EXECUTION_STATUS.MARKED_EXECUTED;
  return true;
}
