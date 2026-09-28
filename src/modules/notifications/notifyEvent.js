import { Notification } from './notification.model.js';
import { findWatcherUserIds } from './entityWatch.model.js';
import { mergeChangeLists } from './fieldDiff.js';
import {
  GROUP_WINDOW_MS,
  canMergePriorities,
  defaultGroupKey,
  resolveEventMeta,
  NOTIFICATION_PRIORITIES,
} from './notificationCatalog.js';
import { resolveNotificationKind } from './notificationQuery.js';
import { expandWithReportingManagers } from './notificationRecipients.js';
import { isArchived } from '../retention/archivePolicy.js';

function dedupeIds(ids = []) {
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const s = String(id || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function sanitizeChanges(changes) {
  if (!Array.isArray(changes)) return [];
  return changes
    .filter((c) => c && (c.field || c.label))
    .slice(0, 40)
    .map((c) => ({
      field: String(c.field || ''),
      label: String(c.label || c.field || ''),
      from: c.from == null ? null : String(c.from),
      to: c.to == null ? null : String(c.to),
    }));
}

/**
 * Resolve recipients: explicit list + optional watchers.
 * Does not invent role-based fans-out; callers pass explicit recipients for legacy events.
 */
export async function resolveNotificationRecipients({
  recipients = [],
  entityType,
  entityId,
  includeWatchers = true,
  excludeUserIds = [],
} = {}) {
  const exclude = new Set((excludeUserIds || []).map(String));
  let ids = [...(recipients || [])];
  if (includeWatchers && entityType && entityId) {
    const watchers = await findWatcherUserIds(entityType, entityId);
    ids = ids.concat(watchers);
  }
  return dedupeIds(ids).filter((id) => !exclude.has(id));
}

async function findOpenGroup({ userId, groupKey, priority, nowMs }) {
  if (!groupKey) return null;
  const candidates = await Notification.find({
    userId,
    groupKey,
    readAt: null,
  })
    .sort({ updatedAt: -1 })
    .limit(20);

  for (const row of candidates) {
    if (!row || row.cancelledAt || isArchived(row)) continue;
    if (!canMergePriorities(row.priority, priority)) continue;
    const updated = new Date(row.updatedAt || row.groupedAt || row.createdAt).getTime();
    if (Number.isNaN(updated)) continue;
    if (nowMs - updated > GROUP_WINDOW_MS) continue;
    return row;
  }
  return null;
}

function buildGroupedTitle(baseTitle, groupCount) {
  const title = String(baseTitle || 'Update').trim();
  if (groupCount <= 1) return title;
  return `${title} (${groupCount} updates)`;
}

/**
 * Create or merge in-app notifications for one or more users.
 * Preserves scheduled delivery fields when provided (verification callbacks).
 */
export async function notifyEvent({
  type,
  title,
  body = '',
  entityType = null,
  entityId = null,
  recipients = [],
  actor = null,
  priority: priorityOverride,
  module: moduleOverride,
  changes = [],
  groupKey: groupKeyOverride,
  group = true,
  includeWatchers = true,
  /** When set, also notify reporting managers of each primary recipient. */
  includeReportingManagers = false,
  excludeUserIds = [],
  excludeActor = false,
  meta = undefined,
  channel = 'IN_APP',
  emailStatus = 'SKIPPED',
  scheduledFor = null,
  deliveredAt = undefined,
  cancelledAt = null,
  readAt = null,
} = {}) {
  const eventType = String(type || '').trim();
  if (!eventType) return [];

  const { priority, module } = resolveEventMeta(eventType, {
    priority: priorityOverride,
    module: moduleOverride,
  });

  const actorId = actor?._id || actor?.id || actor?.userId || null;
  const actorEmail = actor?.email || null;
  const exclude = [...(excludeUserIds || [])];
  if (excludeActor && actorId) exclude.push(actorId);

  let userIds = await resolveNotificationRecipients({
    recipients,
    entityType,
    entityId,
    includeWatchers,
    excludeUserIds: exclude,
  });

  if (includeReportingManagers) {
    const mode = includeReportingManagers === true ? 'chain' : includeReportingManagers;
    userIds = await expandWithReportingManagers(userIds, mode);
    userIds = userIds.filter((id) => !exclude.map(String).includes(String(id)));
  }

  if (!userIds.length) return [];

  const groupKey =
    groupKeyOverride != null
      ? String(groupKeyOverride)
      : group
        ? defaultGroupKey({ type: eventType, entityType, entityId })
        : '';

  const changeList = sanitizeChanges(changes);
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const results = [];

  const kindSeed = {
    type: eventType,
    title: String(title || eventType),
    meta,
  };
  const kind = resolveNotificationKind(kindSeed);
  const metaWithKind =
    meta !== undefined
      ? { ...(meta && typeof meta === 'object' ? meta : {}), kind: meta?.kind || kind }
      : { kind };

  for (const userId of userIds) {
    let row = null;
    if (group && groupKey && !scheduledFor) {
      row = await findOpenGroup({ userId, groupKey, priority, nowMs });
    }

    if (row) {
      const nextCount = Math.max(1, Number(row.groupCount) || 1) + 1;
      row.groupCount = nextCount;
      row.groupedAt = nowIso;
      row.title = buildGroupedTitle(title, nextCount);
      row.body = body || row.body;
      row.priority =
        priority === NOTIFICATION_PRIORITIES.CRITICAL
          ? priority
          : row.priority || priority;
      row.module = module || row.module;
      row.kind = resolveNotificationKind({
        type: row.type || eventType,
        title: row.title,
        meta: metaWithKind,
        kind: row.kind,
      });
      row.changes = mergeChangeLists(row.changes || [], changeList);
      if (actorId) row.actorId = actorId;
      if (actorEmail) row.actorEmail = actorEmail;
      row.meta = metaWithKind;
      await row.save();
      results.push(row);
      continue;
    }

    const created = await Notification.create({
      userId,
      type: eventType,
      title: String(title || eventType),
      body: String(body || ''),
      entityType: entityType || null,
      entityId: entityId || null,
      channel,
      emailStatus,
      readAt,
      scheduledFor,
      deliveredAt: deliveredAt === undefined ? (scheduledFor ? null : nowIso) : deliveredAt,
      cancelledAt,
      priority,
      module,
      kind,
      groupKey: groupKey || null,
      groupCount: 1,
      groupedAt: null,
      actorId: actorId || null,
      actorEmail: actorEmail || null,
      changes: changeList,
      meta: metaWithKind,
    });
    results.push(created);
  }

  return results;
}

/** Convenience: notify a single user (legacy Notification.create shape). */
export async function notifyUser(userId, payload = {}) {
  if (!userId) return null;
  const rows = await notifyEvent({
    ...payload,
    recipients: [userId],
    includeWatchers: payload.includeWatchers === true,
  });
  return rows[0] || null;
}
