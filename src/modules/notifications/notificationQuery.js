/**
 * Shared Mongo/file-safe filters for Notification Center list + badge queries.
 * Prefer pushing predicates to the store so we stop hydrating hundreds of docs per request.
 */

import { applyArchiveListFilter } from '../retention/archivePolicy.js';
import {
  APPROVAL_REQUEST_TYPES,
  isApprovalRequestNotification,
} from './notificationCatalog.js';

export const LIST_SELECT =
  '_id userId type title body entityType entityId readAt createdAt updatedAt groupedAt groupCount priority module actorEmail actorId changes meta kind channel cancelledAt archivedAt scheduledFor deliveredAt';

export const PREVIEW_SELECT =
  '_id type title priority module kind readAt createdAt groupedAt groupCount meta';

const APPROVAL_TITLE_RE =
  'needs (approval|review)|approval required|awaiting approval|pending approval';

/** Persistable inbox bucket for a notification payload. */
export function resolveNotificationKind(n = {}) {
  return isApprovalRequestNotification(n) ? 'approval' : 'update';
}

function nullishOrMissing(field) {
  return {
    $or: [{ [field]: null }, { [field]: '' }, { [field]: { $exists: false } }],
  };
}

/** Active + due (+ archive) base filter for a user's inbox. */
export function buildInboxBaseFilter(userId, query = {}, { now = new Date() } = {}) {
  const filter = { userId: String(userId) };
  if (query.unread === 'true' || query.unread === true) {
    filter.readAt = null;
  }
  if (query.priority) {
    const p = String(query.priority).trim().toLowerCase();
    if (p) filter.priority = p;
  }
  if (query.module) {
    const m = String(query.module).trim().toLowerCase();
    if (m) filter.module = m;
  }
  if (query.type) {
    filter.type = String(query.type);
  }

  applyArchiveListFilter(filter, query);

  const nowIso = now.toISOString();
  filter.$and = [
    ...(filter.$and || []),
    nullishOrMissing('cancelledAt'),
    {
      $or: [
        ...nullishOrMissing('scheduledFor').$or,
        { scheduledFor: { $lte: nowIso } },
      ],
    },
  ];

  return filter;
}

/**
 * Approvals vs Updates. Uses top-level `kind` when present; falls back to type/title
 * for legacy rows written before kind was persisted.
 */
/**
 * Index-friendly approval clause for badge/count polls.
 * Omits title regex (cannot use indexes) — list views still use buildCategoryClause.
 */
export function buildBadgeApprovalClause() {
  return {
    $or: [
      { kind: 'approval' },
      { 'meta.kind': 'approval' },
      { type: { $in: [...APPROVAL_REQUEST_TYPES] } },
    ],
  };
}

/** Index-friendly updates/FYI clause for badge polls (no title regex). */
export function buildBadgeUpdatesClause() {
  return {
    $and: [
      { kind: { $ne: 'approval' } },
      { type: { $nin: [...APPROVAL_REQUEST_TYPES] } },
    ],
  };
}

/** Unread inbox filter for Layout badge — prefers kind/type indexes over title regex. */
export function buildUnreadBadgeFilter(userId, bucket, query = {}, { now = new Date() } = {}) {
  const filter = buildInboxBaseFilter(userId, { ...query, unread: 'true' }, { now });
  const clause = bucket === 'approvals' ? buildBadgeApprovalClause() : buildBadgeUpdatesClause();
  filter.$and = [...(filter.$and || []), clause];
  if (bucket === 'updates') {
    applyInformationalFilter(filter, query, 'updates');
  }
  return filter;
}

export function buildCategoryClause(category) {
  const cat = String(category || '').trim().toLowerCase();
  if (!cat || cat === 'all') return null;

  if (cat === 'approvals') {
    return {
      $or: [
        { kind: 'approval' },
        { 'meta.kind': 'approval' },
        { type: { $in: [...APPROVAL_REQUEST_TYPES] } },
        { title: { $regex: APPROVAL_TITLE_RE, $options: 'i' } },
      ],
    };
  }

  if (cat === 'updates') {
    // kind $ne approval also matches missing/null kind (legacy rows).
    // Title-based approvals without kind are dropped by passesCategorySafety on the page.
    return {
      $and: [
        { kind: { $ne: 'approval' } },
        { type: { $nin: [...APPROVAL_REQUEST_TYPES] } },
      ],
    };
  }

  if (cat === 'system') {
    return { module: 'system' };
  }
  if (cat === 'alerts') {
    return { priority: 'critical' };
  }
  if (cat === 'workflow') {
    return {
      type: {
        $regex: '^(CAMP_|ASSET_|MOVEMENT_|AGREEMENT_|PICKLIST_|COMMERCIAL_)',
        $options: 'i',
      },
    };
  }

  // Treat unknown category as module slug (legacy UI).
  return { module: cat };
}

/** Hide low-signal FYI rows unless the client opts in. */
export function applyInformationalFilter(filter, query = {}, category = '') {
  const cat = String(category || query.category || '').trim().toLowerCase();
  const showInfo =
    query.informational === '1'
    || query.informational === 'true'
    || query.includeInformational === '1'
    || query.includeInformational === 'true';
  const explicitPriority = String(query.priority || '').trim();

  // Only auto-hide informational on Updates (and All when browsing updates-heavy).
  if (showInfo || explicitPriority) return filter;
  if (cat !== 'updates') return filter;

  filter.$and = [
    ...(filter.$and || []),
    { priority: { $in: ['important', 'critical'] } },
  ];
  return filter;
}

export function buildListFilter(userId, query = {}, { now = new Date() } = {}) {
  const filter = buildInboxBaseFilter(userId, query, { now });
  const category = String(query.category || '').trim().toLowerCase();
  const categoryClause = buildCategoryClause(category);
  if (categoryClause) {
    filter.$and = [...(filter.$and || []), categoryClause];
  }
  applyInformationalFilter(filter, query, category);

  const q = String(query.q || '').trim();
  if (q) {
    const re = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { title: { $regex: re, $options: 'i' } },
          { body: { $regex: re, $options: 'i' } },
          { type: { $regex: re, $options: 'i' } },
          { actorEmail: { $regex: re, $options: 'i' } },
        ],
      },
    ];
  }

  return filter;
}

/** Post-filter safety for Updates (title-based approvals that lack kind). */
export function passesCategorySafety(n, category) {
  const cat = String(category || '').trim().toLowerCase();
  if (cat === 'approvals') return isApprovalRequestNotification(n);
  if (cat === 'updates') return !isApprovalRequestNotification(n);
  return true;
}

export function serializeNotification(n, { lean = false } = {}) {
  const row = typeof n?.toObject === 'function' ? n.toObject() : { ...n };
  if (row.meta?.errors) {
    row.meta = { ...row.meta, errors: undefined, errorsOmitted: true };
  }
  if (!row.kind) {
    row.kind = resolveNotificationKind(row);
  }
  if (lean) {
    delete row.deliveryError;
    delete row.deliveryAttempts;
    delete row.emailStatus;
  }
  return row;
}
