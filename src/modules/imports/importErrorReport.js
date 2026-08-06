import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { workbookBuffer } from '../../utils/excelExport.js';
import { Notification } from '../notifications/notification.model.js';
import { uploadDir } from '../../config/paths.js';

/** Legacy disk location — new reports are not written here. */
export const importErrorReportRoot = uploadDir('import-errors');

const MAX_STORED_ERRORS = 2000;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function safeBase(name) {
  return String(name || 'import')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w.\- ]+/g, '_')
    .slice(0, 48);
}

function normalizeErrors(errors) {
  return (Array.isArray(errors) ? errors.filter(Boolean) : [])
    .slice(0, MAX_STORED_ERRORS)
    .map((e) => ({
      row: e.row ?? '',
      field: e.field || '',
      message: e.message || e.reason || 'Import failed',
    }));
}

/** Build failed-rows workbook in memory (never persisted as an upload). */
export function buildImportErrorReportBuffer(errors) {
  const rows = normalizeErrors(errors).map((e) => [e.row, e.field, e.message]);
  return workbookBuffer(['Row', 'Field', 'Reason'], rows, {
    sheetName: 'Failed rows',
    colWidths: [10, 18, 60],
  });
}

/**
 * Build a failed-rows Excel in memory, notify the importer, and keep row errors in
 * notification meta so downloads are regenerated — no Excel/CSV files are stored.
 */
export async function notifyImportFailures(opts) {
  const errors = normalizeErrors(opts.errors);
  if (!errors.length || !opts.userId) return null;

  const reportId = uuid();
  const fileName = `Import_Errors_${safeBase(opts.sourceFileName)}_${stamp()}.xlsx`;

  const totalRows = Number(opts.totalRows) || 0;
  const successRows =
    opts.successRows != null
      ? Number(opts.successRows)
      : Math.max(0, totalRows - errors.length);
  const title = 'Excel import finished with errors';
  const body =
    totalRows > 0
      ? `${errors.length} of ${totalRows} rows failed${successRows ? `; ${successRows} succeeded` : ''}. Download the error report for row-level reasons.`
      : `${errors.length} row${errors.length === 1 ? '' : 's'} failed. Download the error report for details.`;

  const notification = await Notification.create({
    userId: opts.userId,
    type: 'IMPORT_ERRORS',
    title,
    body,
    entityType: opts.entityType || 'ImportErrorReport',
    entityId: opts.entityId || reportId,
    deliveredAt: new Date().toISOString(),
    meta: {
      reportId,
      fileName,
      importType: opts.importType || 'IMPORT',
      sourceFileName: opts.sourceFileName || '',
      errorRows: errors.length,
      totalRows,
      successRows,
      /** Row errors kept in DB so the report workbook is rebuilt on download (no disk file). */
      errors,
      ephemeral: true,
      downloadPath: null,
    },
  });

  notification.meta = {
    ...(notification.meta || {}),
    downloadPath: `/notifications/${notification._id}/error-report`,
  };
  await notification.save();

  return {
    reportId,
    fileName,
    notificationId: notification._id,
    downloadPath: notification.meta.downloadPath,
    errorRows: errors.length,
  };
}

/**
 * Resolve a downloadable error report buffer.
 * Prefers regenerating from stored row errors; falls back to legacy disk files.
 */
export function resolveImportErrorReport(meta = {}) {
  if (Array.isArray(meta.errors) && meta.errors.length) {
    return {
      buffer: buildImportErrorReportBuffer(meta.errors),
      fileName: String(meta.fileName || 'Import_Errors.xlsx').replace(/[^\w.\- ]+/g, '_'),
    };
  }

  // Legacy reports written before ephemeral storage.
  if (meta.reportId) {
    const absolutePath = path.join(importErrorReportRoot, `${meta.reportId}.xlsx`);
    if (fs.existsSync(absolutePath)) {
      return {
        buffer: fs.readFileSync(absolutePath),
        fileName: String(meta.fileName || 'Import_Errors.xlsx').replace(/[^\w.\- ]+/g, '_'),
        legacyPath: absolutePath,
      };
    }
  }
  if (meta.absolutePath && fs.existsSync(meta.absolutePath)) {
    return {
      buffer: fs.readFileSync(meta.absolutePath),
      fileName: String(meta.fileName || 'Import_Errors.xlsx').replace(/[^\w.\- ]+/g, '_'),
      legacyPath: meta.absolutePath,
    };
  }
  return null;
}

/** @deprecated Use resolveImportErrorReport — kept for older call sites. */
export function resolveImportErrorReportPath(meta) {
  const resolved = resolveImportErrorReport(meta);
  return resolved?.legacyPath || null;
}
