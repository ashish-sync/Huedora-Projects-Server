/**
 * Shared 90-day soft-archive helpers.
 * Soft-archive keeps DB rows; default lists hide archivedAt.
 * Attachment compression is opted-in per entity (never for finance/signed legal files).
 */

export const ARCHIVE_IDLE_DAYS = 90;
export const ARCHIVE_WARN_DAYS = 88;
export const DAY_MS = 24 * 60 * 60 * 1000;
/** Only move/compress attachments at or above this size (bytes). */
export const ARCHIVE_MIN_FILE_BYTES = 50 * 1024;

export function isArchived(row) {
  return Boolean(row?.archivedAt);
}

/**
 * Mutates filter for list endpoints.
 * Default: exclude archived. ?archive=1 → only archived. ?archive=all → no archive clause.
 */
export function applyArchiveListFilter(filter, query = {}) {
  const raw = String(query.archive ?? query.archived ?? '').trim().toLowerCase();
  if (raw === 'all' || raw === '*') return filter;

  const onlyArchived = raw === '1' || raw === 'true' || raw === 'only' || raw === 'archived';
  if (onlyArchived) {
    filter.archivedAt = { $ne: null };
    return filter;
  }

  filter.$and = [
    ...(filter.$and || []),
    {
      $or: [
        { archivedAt: null },
        { archivedAt: '' },
        { archivedAt: { $exists: false } },
      ],
    },
  ];
  return filter;
}

export function parseDateMs(raw) {
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

export function daysSince(isoOrDate, now = new Date()) {
  const t = parseDateMs(isoOrDate);
  if (t == null) return 0;
  return (now.getTime() - t) / DAY_MS;
}

/**
 * @returns {'ok' | 'warn' | 'archive'}
 */
export function classifyByClosedAt(closedAt, { archiveWarnedAt = null, now = new Date() } = {}) {
  if (!closedAt) return 'ok';
  const days = daysSince(closedAt, now);
  if (days >= ARCHIVE_IDLE_DAYS) return 'archive';
  if (days >= ARCHIVE_WARN_DAYS && !archiveWarnedAt) return 'warn';
  return 'ok';
}

export function stampArchived(row, { now = new Date(), reason = 'inactive_90d', actorId = null } = {}) {
  row.archivedAt = now.toISOString();
  row.archivedBy = actorId;
  row.archiveReason = reason;
}

export function clearArchive(row) {
  row.archivedAt = null;
  row.archivedBy = null;
  row.archiveReason = '';
  row.archiveWarnedAt = null;
  // archiveBundleKey / archivedAttachmentPaths cleared by restoreFiles helper when used
}
