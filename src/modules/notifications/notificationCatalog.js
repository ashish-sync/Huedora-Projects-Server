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
export const NOTIFICATION_TTL_DAYS = 7;
export const NOTIFICATION_TTL_MS = NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000;
export const NOTIFICATION_TTL_ARCHIVE_REASON = 'notification_ttl_7d';

/** @type {Record<string, { priority: string, module: string }>} */
const EVENT_META = {
  CAMP_REVIEW: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'camp' },
  CAMP_APPROVED: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'camp' },
  CAMP_REJECTED: { priority: NOTIFICATION_PRIORITIES.CRITICAL, module: 'camp' },
  CAMP_INFO_REQUESTED: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'camp' },
  CAMP_REVIEW_OVERDUE: { priority: NOTIFICATION_PRIORITIES.CRITICAL, module: 'camp' },
  CAMP_EXECUTION_OVERDUE: { priority: NOTIFICATION_PRIORITIES.CRITICAL, module: 'camp' },
  CAMP_OFF_HOURS: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'camp' },
  CAMP_WEEKEND_ATTENTION: { priority: NOTIFICATION_PRIORITIES.IMPORTANT, module: 'camp' },
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
  ENTITY_WATCH_UPDATE: { priority: NOTIFICATION_PRIORITIES.INFORMATIONAL, module: 'system' },
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
