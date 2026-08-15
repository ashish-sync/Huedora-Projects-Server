import { Notification } from './notification.model.js';
import { isArchived } from '../retention/archivePolicy.js';
import {
  NOTIFICATION_TTL_ARCHIVE_REASON,
  NOTIFICATION_TTL_MS,
} from './notificationCatalog.js';

function activityMs(row) {
  const raw = row?.groupedAt || row?.updatedAt || row?.createdAt;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Soft-archive notifications older than 7 days (independent of 90-day business retention). */
export async function archiveExpiredNotifications({ now = new Date(), limit = 500 } = {}) {
  const cutoff = now.getTime() - NOTIFICATION_TTL_MS;
  const nowIso = now.toISOString();
  const rows = await Notification.find({}).sort({ createdAt: 1 }).limit(Math.max(limit, 50));
  let archived = 0;
  for (const row of rows) {
    if (isArchived(row)) continue;
    const at = activityMs(row);
    if (!at || at > cutoff) continue;
    row.archivedAt = nowIso;
    row.archivedBy = 'system:notification_ttl';
    row.archiveReason = NOTIFICATION_TTL_ARCHIVE_REASON;
    row.autoArchivedAt = nowIso;
    await row.save();
    archived += 1;
    if (archived >= limit) break;
  }
  return { scanned: rows.length, archived };
}

/** Lazy archive for a single user's inbox (Render-safe without relying only on cron). */
export async function archiveExpiredForUser(userId, { now = new Date(), limit = 100 } = {}) {
  if (!userId) return { archived: 0 };
  const cutoff = now.getTime() - NOTIFICATION_TTL_MS;
  const nowIso = now.toISOString();
  const rows = await Notification.find({ userId }).sort({ createdAt: 1 }).limit(300);
  let archived = 0;
  for (const row of rows) {
    if (isArchived(row)) continue;
    const at = activityMs(row);
    if (!at || at > cutoff) continue;
    row.archivedAt = nowIso;
    row.archivedBy = 'system:notification_ttl';
    row.archiveReason = NOTIFICATION_TTL_ARCHIVE_REASON;
    row.autoArchivedAt = nowIso;
    await row.save();
    archived += 1;
    if (archived >= limit) break;
  }
  return { archived };
}
