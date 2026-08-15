import fs from 'fs';
import { CampOpsCamp } from '../campOps/campOps.model.js';
import { AssetRequest } from '../assetRequests/assetRequest.model.js';
import { Asset } from '../assets/asset.model.js';
import { Movement } from '../movements/movement.model.js';
import { FinanceCommercialDocument, FinanceInvoice } from '../finance/finance.model.js';
import { Agreement } from '../agreements/agreement.model.js';
import { Notification } from '../notifications/notification.model.js';
import { notifyEvent } from '../notifications/notifyEvent.js';
import { ImportJob } from '../imports/importJob.model.js';
import { writeAudit } from '../../utils/audit.js';
import {
  ARCHIVE_IDLE_DAYS,
  ARCHIVE_WARN_DAYS,
  classifyByClosedAt,
  stampArchived,
  isArchived,
} from './archivePolicy.js';
import {
  compressAttachmentsForArchive,
  unlinkArchivedOriginals,
  resolveUploadAbs,
} from './archiveFiles.js';

export {
  ARCHIVE_IDLE_DAYS,
  ARCHIVE_WARN_DAYS,
  classifyByClosedAt,
  applyArchiveListFilter,
  isArchived,
} from './archivePolicy.js';

/** Entities where attachment move/compress is allowed. */
const COMPRESS_ENTITIES = new Set(['camp', 'asset_request', 'movement', 'asset', 'import_job']);

/** Finance / signed docs: UI-archive only — never compress or delete files. */
const UI_ARCHIVE_ONLY = new Set([
  'finance_commercial',
  'vendor_bill',
  'agreement',
]);

function preserveContentClock(row) {
  if (!row.lastContentEditedAt) {
    row.lastContentEditedAt = row.updatedAt || row.createdAt || new Date().toISOString();
  }
}

function recipientIds(row) {
  const ids = new Set();
  for (const id of [
    row.createdById,
    row.updatedById,
    row.requestorId,
    row.submittedById,
    row.approvedById,
  ]) {
    if (id != null && String(id).trim()) ids.add(String(id));
  }
  return [...ids];
}

async function notify(row, { type, title, body, entityType }) {
  const users = recipientIds(row);
  await notifyEvent({
    type,
    title,
    body,
    entityType,
    entityId: row._id,
    recipients: users,
    includeWatchers: true,
    module: 'system',
  });
}

/** Resolve closed-at for a camp (rejects/cancels/paid financial). */
export function campClosedAt(camp) {
  const status = String(camp.status || '');
  if (status === 'rejected' || status === 'cancelled') {
    return camp.updatedAt || camp.executedAt || camp.createdAt;
  }
  if (String(camp.financePaymentStatus || '') === 'paid') {
    return camp.financeProcessedAt || camp.updatedAt || camp.submittedToFinanceAt;
  }
  const exec = String(camp.executionStatus || '');
  if (exec === 'Cancelled' || exec === 'Refused') {
    return camp.updatedAt || camp.executedAt;
  }
  return null;
}

export function requestClosedAt(row) {
  const status = String(row.status || '').toUpperCase();
  if (!['COMPLETED', 'REJECTED', 'CANCELLED'].includes(status)) return null;
  return row.completedAt || row.rejectedAt || row.cancelledAt || row.updatedAt || row.createdAt;
}

export function movementClosedAt(row) {
  const status = String(row.status || '').toUpperCase();
  if (!['RECEIVED', 'REJECTED', 'CANCELLED'].includes(status)) return null;
  return row.receivedAt || row.updatedAt || row.createdAt;
}

export function assetClosedAt(row) {
  const status = String(row.status || '');
  if (!['Retired', 'Disposed'].includes(status)) return null;
  return row.statusChangedAt || row.updatedAt || row.createdAt;
}

export function commercialClosedAt(row) {
  if (row.isDeleted) return null;
  const status = String(row.status || '');
  // Drafts handled by 30-day purge — not 90-day archive.
  if (status === 'Draft') return null;
  if (status === 'Cancelled') return row.cancelledAt || row.updatedAt;
  if (status === 'Issued' || status === 'Converted') {
    if (String(row.paymentStatus || '') === 'Fully paid') {
      return row.paidAt || row.issuedAt || row.updatedAt;
    }
    // Issued but unpaid stays active for collections.
    if (status === 'Converted') return row.updatedAt || row.issuedAt;
    return null;
  }
  if (status === 'Approved' || status === 'Uploaded') {
    // Treat long-closed approved/uploaded without issue as archive candidates via updatedAt only if cancelled-like — skip.
    return null;
  }
  return null;
}

export function vendorBillClosedAt(row) {
  const status = String(row.status || '').toLowerCase();
  if (status === 'paid') return row.paidAt || row.archivedAt || row.updatedAt;
  if (status === 'cancelled') return row.updatedAt || row.createdAt;
  return null;
}

export function agreementClosedAt(row) {
  const status = String(row.status || '').toUpperCase();
  if (['COMPLETED', 'ACTIVE', 'TERMINATED', 'DECLINED'].includes(status)) {
    return row.terminatedAt || row.declinedAt || row.completedAt || row.activatedAt || row.updatedAt;
  }
  return null;
}

export function notificationClosedAt(row) {
  if (row.cancelledAt) return row.cancelledAt;
  if (row.readAt) return row.readAt;
  return null;
}

export function importJobClosedAt(row) {
  const status = String(row.status || '').toUpperCase();
  if (!['SUCCEEDED', 'FAILED'].includes(status)) return null;
  return row.finishedAt || row.completedAt || row.updatedAt || row.createdAt;
}

export function classifyEntity(entityType, row, now = new Date()) {
  if (!row || row.isDeleted || isArchived(row)) return 'ok';
  let closedAt = null;
  switch (entityType) {
    case 'camp':
      closedAt = campClosedAt(row);
      break;
    case 'asset_request':
      closedAt = requestClosedAt(row);
      break;
    case 'movement':
      closedAt = movementClosedAt(row);
      break;
    case 'asset':
      closedAt = assetClosedAt(row);
      break;
    case 'finance_commercial':
      closedAt = commercialClosedAt(row);
      break;
    case 'vendor_bill':
      closedAt = vendorBillClosedAt(row);
      break;
    case 'agreement':
      closedAt = agreementClosedAt(row);
      break;
    case 'notification':
      closedAt = notificationClosedAt(row);
      break;
    case 'import_job':
      closedAt = importJobClosedAt(row);
      break;
    default:
      return 'ok';
  }
  return classifyByClosedAt(closedAt, { archiveWarnedAt: row.archiveWarnedAt, now });
}

async function processRow(entityType, row, { now, dryRun, label }) {
  const action = classifyEntity(entityType, row, now);
  if (action === 'ok') return action;

  const nowIso = now.toISOString();
  const skipCompress = UI_ARCHIVE_ONLY.has(entityType) || !COMPRESS_ENTITIES.has(entityType);

  if (action === 'warn') {
    if (!dryRun) {
      preserveContentClock(row);
      row.archiveWarnedAt = nowIso;
      await row.save();
      await notify(row, {
        type: 'RETENTION_ARCHIVE_WARN',
        title: `Will be archived soon: ${label}`,
        body: `This record has been closed for ~${ARCHIVE_WARN_DAYS}+ days and will be archived after ${ARCHIVE_IDLE_DAYS} days. Open it or restore later from Archive views.`,
        entityType,
      });
      await writeAudit({
        actorType: 'SYSTEM',
        actorEmail: 'system@tylo.one',
        action: 'RETENTION.ARCHIVE_WARN',
        entityType,
        entityId: row._id,
        message: `Warned 90-day archive (${entityType})`,
      });
    }
    return 'warn';
  }

  if (action === 'archive') {
    if (!dryRun) {
      const before = row.toObject ? row.toObject() : { ...row };
      await notify(row, {
        type: 'RETENTION_ARCHIVED',
        title: `Archived: ${label}`,
        body: skipCompress
          ? `This record was UI-archived after ${ARCHIVE_IDLE_DAYS} days closed. Original files were retained for legal/financial requirements.`
          : `This record was archived after ${ARCHIVE_IDLE_DAYS} days closed. Large attachments were moved to the archive store; you can restore the record from Archive views.`,
        entityType,
      });

      preserveContentClock(row);
      stampArchived(row, { now, reason: 'inactive_90d' });

      let packedPaths = [];
      if (!skipCompress) {
        const packed = await compressAttachmentsForArchive(row, { entityType, skipCompress: false });
        packedPaths = packed.archivedAttachmentPaths || [];
        row.archiveBundleKey = packed.archiveBundleKey || '';
        // Do not persist absolute filesystem paths on the document.
        row.archivedAttachmentPaths = packedPaths.map(({ originalAbs, ...rest }) => rest);
      }

      try {
        await row.save();
      } catch (err) {
        // Metadata save failed — drop orphan .gz copies; originals were never unlinked.
        for (const entry of packedPaths) {
          const gzAbs = resolveUploadAbs(entry.archivedRel);
          if (!gzAbs) continue;
          try {
            await fs.promises.unlink(gzAbs);
          } catch {
            /* ignore */
          }
        }
        throw err;
      }
      if (!skipCompress && packedPaths.length) {
        await unlinkArchivedOriginals(packedPaths);
      }
      await writeAudit({
        actorType: 'SYSTEM',
        actorEmail: 'system@tylo.one',
        action: 'RETENTION.ARCHIVE',
        entityType,
        entityId: row._id,
        before,
        after: {
          archivedAt: row.archivedAt,
          archiveReason: row.archiveReason,
          archiveBundleKey: row.archiveBundleKey || '',
          uiOnly: skipCompress,
        },
        message: `90-day archive (${entityType})`,
      });
    }
    return 'archive';
  }

  return 'ok';
}

function campLabel(c) {
  return `Camp ${c.campId || c._id} · ${c.clientName || ''}`.trim();
}

/**
 * Soft-archive closed records ≥90 days; warn at 88 days.
 * Finance commercial / vendor bills / agreements: UI-archive only (no file compress).
 */
export async function runNinetyDayArchive({ now = new Date(), dryRun = false } = {}) {
  const counts = {
    warned: 0,
    archived: 0,
    scanned: 0,
    byType: {},
  };

  async function scan(entityType, rows, labelFn) {
    for (const row of rows) {
      counts.scanned += 1;
      const result = await processRow(entityType, row, {
        now,
        dryRun,
        label: labelFn(row),
      });
      if (result === 'warn') {
        counts.warned += 1;
        counts.byType[entityType] = counts.byType[entityType] || { warned: 0, archived: 0 };
        counts.byType[entityType].warned += 1;
      } else if (result === 'archive') {
        counts.archived += 1;
        counts.byType[entityType] = counts.byType[entityType] || { warned: 0, archived: 0 };
        counts.byType[entityType].archived += 1;
      }
    }
  }

  const camps = await CampOpsCamp.find({ isDeleted: false });
  await scan('camp', camps, campLabel);

  const requests = await AssetRequest.find({ isDeleted: false });
  await scan(
    'asset_request',
    requests,
    (r) => `${r.requestType || 'Request'} ${r.requestNumber || r._id}`,
  );

  const movements = await Movement.find({ isDeleted: false });
  await scan('movement', movements, (r) => `Movement ${r._id}`);

  const assets = await Asset.find({ isDeleted: false, status: { $in: ['Retired', 'Disposed'] } });
  await scan('asset', assets, (r) => `Asset ${r.assetTag || r._id}`);

  const commercials = await FinanceCommercialDocument.find({ isDeleted: false });
  await scan(
    'finance_commercial',
    commercials,
    (r) => `${r.documentType || 'Doc'} ${r.documentNumber || r.docKey || r._id}`,
  );

  const bills = await FinanceInvoice.find({ isDeleted: false });
  await scan(
    'vendor_bill',
    bills,
    (r) => `Vendor bill ${r.billNumber || r.invoiceNumber || r._id}`,
  );

  const agreements = await Agreement.find({ isDeleted: false });
  await scan('agreement', agreements, (r) => `Agreement ${r.title || r._id}`);

  const notifications = await Notification.find({}).limit(5000);
  await scan('notification', notifications, (r) => r.title || `Notification ${r._id}`);

  let importJobs = [];
  try {
    importJobs = await ImportJob.find({});
  } catch {
    importJobs = [];
  }
  await scan('import_job', importJobs, (r) => `Import ${r._id}`);

  return counts;
}

/** Manual restore: clear archive flags and optionally restore compressed files. */
export async function restoreArchivedRecord(row, { entityType, restoreFiles = true } = {}) {
  if (!isArchived(row)) return { ok: false, reason: 'not_archived' };
  const skipCompress = UI_ARCHIVE_ONLY.has(entityType);
  if (restoreFiles && !skipCompress) {
    const { restoreArchivedAttachments } = await import('./archiveFiles.js');
    await restoreArchivedAttachments(row);
  }
  row.archivedAt = null;
  row.archivedBy = null;
  row.archiveReason = '';
  row.archiveWarnedAt = null;
  await row.save();
  return { ok: true };
}
