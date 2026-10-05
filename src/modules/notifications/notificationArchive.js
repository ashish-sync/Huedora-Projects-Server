import { Notification } from './notification.model.js';
import { isArchived } from '../retention/archivePolicy.js';
import {
  NOTIFICATION_APPROVAL_TTL_MS,
  NOTIFICATION_APPROVAL_TTL_REASON,
  NOTIFICATION_FYI_TTL_MS,
  NOTIFICATION_TTL_ARCHIVE_REASON,
  isApprovalRequestNotification,
} from './notificationCatalog.js';

function activityMs(row) {
  const raw = row?.groupedAt || row?.updatedAt || row?.createdAt;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function isReadOrActioned(row = {}) {
  return Boolean(row.readAt || row.cancelledAt);
}

/**
 * FYI: purge after 7d.
 * Approvals: purge after 14d only if already read or actioned (unread stay).
 */
export function shouldPurgeNotification(row, { now = new Date() } = {}) {
  if (!row || isArchived(row)) return false;
  const at = activityMs(row);
  if (!at) return false;
  const nowMs = now.getTime();

  if (isApprovalRequestNotification(row)) {
    if (!isReadOrActioned(row)) return false;
    return at <= nowMs - NOTIFICATION_APPROVAL_TTL_MS;
  }

  return at <= nowMs - NOTIFICATION_FYI_TTL_MS;
}

function purgeReason(row) {
  return isApprovalRequestNotification(row)
    ? NOTIFICATION_APPROVAL_TTL_REASON
    : NOTIFICATION_TTL_ARCHIVE_REASON;
}

async function purgeRow(row) {
  // Hard-delete from inbox store (TTL cleanup). Reason kept only in logs via return.
  await Notification.deleteOne({ _id: row._id });
  return purgeReason(row);
}

/** Purge expired notifications (FYI 7d; Approvals 14d if read/actioned). */
export async function archiveExpiredNotifications({ now = new Date(), limit = 500 } = {}) {
  const rows = await Notification.find({}).sort({ createdAt: 1 }).limit(Math.max(limit * 3, 50));
  let archived = 0;
  let scanned = 0;
  for (const row of rows) {
    scanned += 1;
    if (!shouldPurgeNotification(row, { now })) continue;
    await purgeRow(row);
    archived += 1;
    if (archived >= limit) break;
  }
  return { scanned, archived, deleted: archived };
}

/** Lazy purge for a single user's inbox (Render-safe without relying only on cron). */
export async function archiveExpiredForUser(userId, { now = new Date(), limit = 100 } = {}) {
  if (!userId) return { archived: 0, deleted: 0 };
  const rows = await Notification.find({ userId }).sort({ createdAt: 1 }).limit(300);
  let archived = 0;
  for (const row of rows) {
    if (!shouldPurgeNotification(row, { now })) continue;
    await purgeRow(row);
    archived += 1;
    if (archived >= limit) break;
  }
  return { archived, deleted: archived };
}
