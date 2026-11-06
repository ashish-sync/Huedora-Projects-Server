/**
 * Event → priority / module catalog for the platform Notification Center.
 * Existing event type strings are preserved; priorities are additive metadata.
 */

export const NOTIFICATION_PRIORITIES = Object.freeze({
  INFORMATIONAL: 'informational',
  IMPORTANT: 'important',
  CRITICAL: 'critical',
});

export const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** FYI / Updates — auto-delete after this age (any read state). */
export const NOTIFICATION_FYI_TTL_DAYS = 7;
export const NOTIFICATION_FYI_TTL_MS = NOTIFICATION_FYI_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Approvals — auto-delete after this age only when already read or actioned.
 * Unread / unactioned approvals are kept until the manager handles them.
 */
export const NOTIFICATION_APPROVAL_TTL_DAYS = 14;
export const NOTIFICATION_APPROVAL_TTL_MS =
  NOTIFICATION_APPROVAL_TTL_DAYS * 24 * 60 * 60 * 1000;

/** @deprecated Use NOTIFICATION_FYI_TTL_* — kept for older imports/tests. */
export const NOTIFICATION_TTL_DAYS = NOTIFICATION_FYI_TTL_DAYS;
export const NOTIFICATION_TTL_MS = NOTIFICATION_FYI_TTL_MS;
export const NOTIFICATION_TTL_ARCHIVE_REASON = 'notification_ttl_fyi_7d';
export const NOTIFICATION_APPROVAL_TTL_REASON = 'notification_ttl_approval_14d_read';

/** @type {Record<string, { priority: string, module: string }>} */
const EVENT_META = {
  // Camp One review queue is FYI / Updates — not reporting-manager Approvals.
  CAMP_REVIEW: { priority: NOTIFICATION_PRIORITIES.INFORMATIONAL, module: 'camp' },
  CAMP_APPROVED: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'camp' },
  CAMP_REJECTED: { priority: NOTIFICATION_PRIORITIES.CRITICAL, module: 'camp' },
  CAMP_INFO_REQUESTED: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'camp' },
  CAMP_REVIEW_OVERDUE: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'camp' },
  CAMP_EXECUTION_OVERDUE: { priority: NOTIFICATION_PRIORITIES.CRITICAL, module: 'camp' },
  CAMP_OFF_HOURS: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'camp' },
  CAMP_WEEKEND_ATTENTION: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'camp' },
  CAMP_BULK_SUCCESS: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'camp' },
  CAMP_BULK_PARTIAL: { priority: NOTIFICATION_PRIORITIES.CRITICAL, module: 'camp' },
  CAMP_BULK_REJECT: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'camp' },
  // Short HCW gap override — reporting manager must approve (Approvals inbox).
  CAMP_HCW_GAP_APPROVAL: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'camp' },
  CAMP_T2_APPROVAL: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'camp' },
  CAMP_CANCELLED_TYLO: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'camp' },
  CAMP_INFO_UNANSWERED: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'camp' },
  ASSET_CREATE_APPROVAL: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'assets' },
  ASSET_CHANGE: { priority: NOTIFICATION_PRIORITIES.INFORMATIONAL, module: 'assets' },
  AGREEMENT_TERMINATED: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'documents' },
  AGREEMENT_UNSIGNED: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'documents' },
  VERIFICATION_LINK_EXPIRED: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'assets' },
  VERIFICATION_MONTHLY_REPORT: { priority: NOTIFICATION_PRIORITIES.INFORMATIONAL, module: 'assets' },
  ASSET_REQUEST_APPROVAL: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'assets' },
  MOVEMENT_APPROVAL: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'assets' },
  VERIFICATION_CALLBACK: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'assets' },
  AGREEMENT_SENT: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'documents' },
  PICKLIST_SUGGESTION: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'masters' },
  PICKLIST_APPROVED: { priority: NOTIFICATION_PRIORITIES.INFORMATIONAL, module: 'masters' },
  PICKLIST_REJECTED: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'masters' },
  IMPORT_ERRORS: { priority: NOTIFICATION_PRIORITIES.CRITICAL, module: 'system' },
  RETENTION_ARCHIVE_WARN: { priority: NOTIFICATION_PRIORITIES.CRITICAL, module: 'system' },
  RETENTION_ARCHIVED: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'system' },
  COMMERCIAL_DRAFT_WARN: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'finance' },
  COMMERCIAL_DRAFT_PURGED: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'finance' },
  COMMERCIAL_PAYMENT: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'finance' },
  COMMERCIAL_SUBMIT: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'finance' },
  COMMERCIAL_APPROVED: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'finance' },
  COMMERCIAL_REJECTED: { priority: NOTIFICATION_PRIORITIES.CRITICAL, module: 'finance' },
  VENDOR_BILL_SUBMITTED: { priority: NOTIFICATION_PRIORITIES.INFORMATIONAL, module: 'finance' },
  VENDOR_BILL_VERIFIED: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'finance' },
  VENDOR_BILL_APPROVED: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'finance' },
  VENDOR_BILL_REJECTED: { priority: NOTIFICATION_PRIORITIES.CRITICAL, module: 'finance' },
  ENTITY_WATCH_UPDATE: { priority: NOTIFICATION_PRIORITIES.INFORMATIONAL, module: 'system' },
  CALENDAR_REMINDER: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'calendar' },
  CALENDAR_BLOCK: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'calendar' },
  CALENDAR_AVAILABILITY_REQUEST: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'calendar' },
  CALENDAR_ACCEPTED: { priority: NOTIFICATION_PRIORITIES.INFORMATIONAL, module: 'calendar' },
  CALENDAR_DECLINED: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'calendar' },
  CALENDAR_SUGGESTED: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'calendar' },
};

export function resolveEventMeta(type, overrides = {}) {
  const key = String(type || '').trim();
  const base = EVENT_META[key] || {
    priority: NOTIFICATION_PRIORITIES.INFORMATIONAL,
    module: 'system',
  };
  const priority = String(overrides.priority || base.priority || NOTIFICATION_PRIORITIES.INFORMATIONAL)
    .trim()
    .toLowerCase();
  const module = String(overrides.module || base.module || 'system').trim() || 'system';
  const allowed = Object.values(NOTIFICATION_PRIORITIES);
  return {
    priority: allowed.includes(priority) ? priority : NOTIFICATION_PRIORITIES.INFORMATIONAL,
    module,
  };
}

export function defaultGroupKey({ type, entityType, entityId } = {}) {
  const t = String(type || '').trim() || 'EVENT';
  const et = String(entityType || '').trim() || 'Entity';
  const eid = String(entityId || '').trim() || 'none';
  return `${et}:${eid}:${t}`;
}

/** Critical never merges into a lower-priority open group. */
export function canMergePriorities(existingPriority, incomingPriority) {
  const a = String(existingPriority || '').toLowerCase();
  const b = String(incomingPriority || '').toLowerCase();
  if (b === NOTIFICATION_PRIORITIES.CRITICAL && a !== NOTIFICATION_PRIORITIES.CRITICAL) {
    return false;
  }
  return true;
}

/**
 * Types that always mean “action required from a reporting manager” (Approvals inbox).
 * Request One uses ASSET_REQUEST_APPROVAL / MOVEMENT_APPROVAL + “needs approval” title / kind.
 */
export const APPROVAL_REQUEST_TYPES = Object.freeze([
  'PICKLIST_SUGGESTION',
  'CAMP_HCW_GAP_APPROVAL',
  'CAMP_T2_APPROVAL',
  'ASSET_CREATE_APPROVAL',
  'COMMERCIAL_SUBMIT',
  'VENDOR_BILL_VERIFIED',
  'CALENDAR_AVAILABILITY_REQUEST',
]);

/**
 * Camp One FYI / Updates only (not reporting-manager Approvals).
 * Keep CAMP_HCW_GAP_APPROVAL out of this list.
 */
export const CAMP_FYI_NOTIFICATION_TYPES = Object.freeze([
  'CAMP_REVIEW',
  'CAMP_APPROVED',
  'CAMP_REJECTED',
  'CAMP_INFO_REQUESTED',
  'CAMP_REVIEW_OVERDUE',
  'CAMP_EXECUTION_OVERDUE',
  'CAMP_OFF_HOURS',
  'CAMP_WEEKEND_ATTENTION',
  'CAMP_BULK_SUCCESS',
  'CAMP_BULK_PARTIAL',
  'CAMP_BULK_REJECT',
  'CAMP_CANCELLED_TYLO',
  'CAMP_INFO_UNANSWERED',
]);

export function isCampFyiNotificationType(type) {
  return CAMP_FYI_NOTIFICATION_TYPES.includes(String(type || '').trim().toUpperCase());
}

/**
 * True when the inbox item is a reporting-manager approval request
 * (Request One, picklist, HCW gap override, etc.).
 * Routine Camp One “needs review” notices are FYI even on legacy rows.
 */
export function isReviewNotification(n = {}) {
  const kind = String(n?.meta?.kind || n?.kind || '').toLowerCase();
  if (kind === 'review') return true;
  return String(n?.meta?.involvement || '').toLowerCase() === 'review';
}

export function isApprovalRequestNotification(n = {}) {
  const type = String(n?.type || '').trim().toUpperCase();
  const kind = String(n?.meta?.kind || n?.kind || '').toLowerCase();
  if (kind === 'review' || kind === 'escalate') return false;
  if (isCampFyiNotificationType(type)) return false;

  if (kind === 'approval') return true;
  if (kind === 'update') return false;

  if (APPROVAL_REQUEST_TYPES.includes(type)) return true;

  const title = String(n?.title || '').toLowerCase();
  if (/reporting manager/.test(title) && /approval|approve/.test(title)) return true;
  if (/needs (approval|review)/i.test(title)) return true;
  if (/approval required|awaiting approval|pending approval/i.test(title)) return true;

  // Shared type for request + decision — only the "needs approval" form is a request.
  if (type === 'ASSET_REQUEST_APPROVAL' || type === 'MOVEMENT_APPROVAL') {
    return /needs approval/.test(title);
  }
  return false;
}
