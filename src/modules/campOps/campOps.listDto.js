import { withCampSchedule } from './campOps.helpers.js';
import { withRequestReview } from './campOps.requestReview.js';
import {
  normalizeLifecycleStage,
  resolveEffectiveExecutionStatus,
  CAMP_LIFECYCLE_STAGES,
} from './campOps.lifecycle.js';
import { getRequestStageBlockers } from './campOps.requestValidation.js';
import { localTodayIso } from './campDatePolicy.js';

/** Fields Manage Camps / board lists need — omit heavy blobs and file URLs. */
const LIST_KEEP = new Set([
  '_id',
  'campId',
  'clientId',
  'client',
  'clientName',
  'campaignType',
  'campaignName',
  'campDate',
  'requestDate',
  'state',
  'city',
  'doctorName',
  'startTime',
  'endTime',
  'durationHours',
  'campSlot',
  'timeFrame',
  'endsAt',
  'isOverdue',
  'status',
  'lifecycleStage',
  'lifecycleStages',
  'executionStatus',
  'effectiveExecutionStatus',
  'assignmentStatus',
  'assignmentDecision',
  'hiringRequestedAt',
  'hiringRequestNumber',
  'assignmentRefusalReason',
  'hcwCategory',
  'hcwName',
  'hcwContact',
  'chargeableStatus',
  'inTime',
  'attire',
  'paymentSubmitStatus',
  'financePaymentStatus',
  'requestReviewStatus',
  'requestReviewStatusLabel',
  'isReviewOverdue',
  'submittedAt',
  'informationRequestNote',
  'rejectionReason',
  'alertLevel',
  'alertReason',
  'cancelledBy',
  'cancelReason',
  'cancelSource',
  'closureReason',
  'approvalBlockers',
  'requestStageComplete',
  'canApprove',
  'canRequestInformation',
  'requestIncomplete',
  'createdAt',
  'updatedAt',
]);

/**
 * Lean lifecycle for lists: stage + effective execution only (no finance formula math).
 */
export function withCampLifecycleList(camp) {
  const obj = camp?.toObject ? camp.toObject() : { ...camp };
  obj.lifecycleStage = normalizeLifecycleStage(obj.lifecycleStage, 'request');
  obj.lifecycleStages = CAMP_LIFECYCLE_STAGES;
  obj.effectiveExecutionStatus = resolveEffectiveExecutionStatus(obj);
  return obj;
}

/**
 * List enrichment: schedule + review + approval flags. Never signs file URLs.
 */
export function enrichCampList(camp) {
  const obj = withRequestReview(withCampLifecycleList(withCampSchedule(camp)));
  const approvalBlockers = getRequestStageBlockers(obj);
  if (obj.requestIncomplete) {
    approvalBlockers.unshift(
      'Request data is incomplete — complete all required fields before approval',
    );
  }
  obj.approvalBlockers = approvalBlockers;
  obj.requestStageComplete = approvalBlockers.length === 0;
  const pendingReview = obj.status === 'pending_review';
  obj.canApprove = pendingReview && approvalBlockers.length === 0;
  obj.canRequestInformation = pendingReview;
  return projectCampList(obj);
}

export function projectCampList(camp) {
  const out = {};
  for (const key of LIST_KEEP) {
    if (Object.prototype.hasOwnProperty.call(camp, key) && camp[key] !== undefined) {
      out[key] = camp[key];
    }
  }
  return out;
}

export function compareCampListOrder(a, b, today = localTodayIso()) {
  const ad = String(a.campDate || '');
  const bd = String(b.campDate || '');
  const aUpcoming = Boolean(ad && ad >= today);
  const bUpcoming = Boolean(bd && bd >= today);
  if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
  if (ad !== bd) return ad.localeCompare(bd);
  const at = String(a.startTime || '');
  const bt = String(b.startTime || '');
  if (at !== bt) return at.localeCompare(bt);
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
}

/**
 * Cheap predicate helpers — avoid full enrichCamp / URL signing.
 */
export function cheapRequestReviewStatus(camp, status) {
  return withRequestReview(withCampSchedule(camp)).requestReviewStatus === status;
}

export function cheapIsOverdue(camp) {
  return withCampSchedule(camp).isOverdue === true;
}

export function cheapEffectiveCamp(camp) {
  return withCampLifecycleList(withCampSchedule(camp));
}
