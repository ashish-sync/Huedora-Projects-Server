/** Request Stage review statuses and 6 working-hour overdue rules (9 AM–7 PM, exclude Sundays). */

export const REQUEST_REVIEW_STATUSES = [
  'review_pending',
  'review_overdue',
  'information_requested',
  'request_approved',
  'request_rejected',
];

export const REQUEST_REVIEW_LABELS = {
  review_pending: 'Review Pending',
  review_overdue: 'Review Overdue',
  information_requested: 'Information Requested',
  request_approved: 'Request Approved',
  request_rejected: 'Request Rejected',
};

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 19;
const SIX_WORKING_HOURS_MS = 6 * 60 * 60 * 1000;

function workWindowForDate(date) {
  const d = new Date(date);
  if (d.getDay() === 0) return null;
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  return {
    start: new Date(y, m, day, WORK_START_HOUR, 0, 0, 0).getTime(),
    end: new Date(y, m, day, WORK_END_HOUR, 0, 0, 0).getTime(),
  };
}

/** Elapsed milliseconds between two instants, counting only 9 AM–7 PM on non-Sunday days. */
export function elapsedWorkingMs(start, end = new Date()) {
  const t0 = new Date(start).getTime();
  const t1 = new Date(end).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return 0;

  let total = 0;
  const cursor = new Date(t0);
  cursor.setHours(0, 0, 0, 0);

  while (cursor.getTime() < t1) {
    const window = workWindowForDate(cursor);
    if (window) {
      const segStart = Math.max(t0, window.start);
      const segEnd = Math.min(t1, window.end);
      if (segEnd > segStart) total += segEnd - segStart;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

export function isReviewOverdue(submittedAt, now = new Date()) {
  if (!submittedAt) return false;
  return elapsedWorkingMs(submittedAt, now) >= SIX_WORKING_HOURS_MS;
}

export function resolveRequestReviewStatus(camp = {}, now = new Date()) {
  if (camp.requestReviewStatus === 'information_requested' && camp.status === 'pending_review') {
    return 'information_requested';
  }
  if (camp.status === 'approved') return 'request_approved';
  if (camp.status === 'rejected') return 'request_rejected';
  if (camp.status === 'pending_review') {
    if (isReviewOverdue(camp.submittedAt, now)) return 'review_overdue';
    return camp.requestReviewStatus === 'information_requested' ? 'information_requested' : 'review_pending';
  }
  return camp.requestReviewStatus || '';
}

export function withRequestReview(camp, now = new Date()) {
  const obj = camp?.toObject ? camp.toObject() : { ...camp };
  const resolved = resolveRequestReviewStatus(obj, now);
  obj.requestReviewStatus = resolved;
  obj.requestReviewStatusLabel = REQUEST_REVIEW_LABELS[resolved] || '';
  obj.isReviewOverdue = resolved === 'review_overdue';
  return obj;
}

export function applyRequestReviewTransition(camp, action, { actor = null, reason = '' } = {}) {
  if (action === 'submit') {
    camp.requestReviewStatus = 'review_pending';
    camp.informationRequestNote = '';
    camp.informationRequestedAt = null;
    camp.informationRequestedByEmail = '';
    camp.reviewOverdueAt = null;
    return;
  }
  if (action === 'approve') {
    camp.requestReviewStatus = 'request_approved';
    return;
  }
  if (action === 'reject') {
    camp.requestReviewStatus = 'request_rejected';
    camp.rejectionReason = reason;
    return;
  }
  if (action === 'request_information') {
    camp.requestReviewStatus = 'information_requested';
    camp.informationRequestNote = reason;
    camp.informationRequestedAt = new Date().toISOString();
    camp.informationRequestedById = actor?.id || null;
    camp.informationRequestedByEmail = actor?.email || '';
    camp.reviewOverdueAt = null;
  }
}

export async function persistRequestReviewOverdue(camp, now = new Date()) {
  if (!camp || camp.status !== 'pending_review') return { becameOverdue: false };
  if (camp.requestReviewStatus === 'information_requested') return { becameOverdue: false };
  if (!isReviewOverdue(camp.submittedAt, now)) return { becameOverdue: false };
  const alreadyOverdue = camp.requestReviewStatus === 'review_overdue' && camp.reviewOverdueAt;
  if (alreadyOverdue) return { becameOverdue: false };
  camp.requestReviewStatus = 'review_overdue';
  if (!camp.reviewOverdueAt) camp.reviewOverdueAt = now.toISOString();
  await camp.save();
  return { becameOverdue: true };
}
