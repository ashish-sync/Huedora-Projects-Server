import { applyRequestReviewTransition } from './campOps.requestReview.js';

export const CAMP_CLOSURE_TYPES = [
  'Cancelled by TCPL',
  'Refused',
  'Cancelled by Client',
];

export const CAMP_CLOSURE_REASON_CODES = ['1', '2', '3', '4', '5'];

const LEGACY_REFUSAL_ALIASES = {
  Rejected: 'Refused',
};

export function normalizeClosureType(value = '') {
  const raw = String(value || '').trim();
  return LEGACY_REFUSAL_ALIASES[raw] || raw;
}

export function buildClosureRemark(closureType, reasonCode) {
  return `${closureType} — Reason ${reasonCode}`;
}

export function canCloseCampStatus(status) {
  return !['cancelled', 'rejected'].includes(String(status || '').trim());
}

export function applyCampClosure(camp, { closureType, reasonCode, actor } = {}) {
  const normalizedType = normalizeClosureType(closureType);
  const code = String(reasonCode || '').trim();

  if (!CAMP_CLOSURE_TYPES.includes(normalizedType)) {
    throw new Error('Select a closure type');
  }
  if (!CAMP_CLOSURE_REASON_CODES.includes(code)) {
    throw new Error('Select a reason code');
  }
  if (!canCloseCampStatus(camp.status)) {
    throw new Error('Camp is already closed');
  }

  const remark = buildClosureRemark(normalizedType, code);

  camp.closureReasonCode = code;
  camp.cancellationReason = remark;
  camp.assignmentRefusalReason = normalizedType;
  camp.assignmentDecision = 'refuse';
  camp.assignmentStatus = 'Unassigned';
  camp.hcwContactId = null;
  camp.hcwCategory = '';
  camp.hcwName = '';
  camp.hcwContact = '';
  camp.remarks = remark;

  if (normalizedType === 'Refused') {
    const wasPendingReview = camp.status === 'pending_review';
    camp.status = 'rejected';
    camp.rejectionReason = remark;
    if (wasPendingReview) {
      applyRequestReviewTransition(camp, 'reject', { reason: remark, actor });
    }
    return;
  }

  camp.status = 'cancelled';
  camp.cancelledBy = normalizedType === 'Cancelled by Client' ? 'brand' : 'khw';
  if (camp.executionStatus === 'Pending') {
    camp.executionStatus = 'Cancelled';
  }
}
