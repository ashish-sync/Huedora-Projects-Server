import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { workbookBuffer } from '../../utils/excelExport.js';
import { Notification } from '../notifications/notification.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const importErrorReportRoot = path.resolve(__dirname, '../../../uploads/import-errors');
fs.mkdirSync(importErrorReportRoot, { recursive: true });

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

/**
 * Build a failed-rows Excel, store it, and notify the importer.
 * @param {{
 *   userId: string,
 *   importType: string,
 *   sourceFileName?: string,
 *   totalRows?: number,
 *   successRows?: number,
 *   errors: Array<{ row?: number|string, field?: string, message?: string, reason?: string }>,
 *   entityType?: string,
 *   entityId?: string,
 * }} opts
 */
export async function notifyImportFailures(opts) {
  const errors = Array.isArray(opts.errors) ? opts.errors.filter(Boolean) : [];
  if (!errors.length || !opts.userId) return null;

  const reportId = uuid();
  const fileName = `Import_Errors_${safeBase(opts.sourceFileName)}_${stamp()}.xlsx`;
  const absolutePath = path.join(importErrorReportRoot, `${reportId}.xlsx`);

  const headers = ['Row', 'Field', 'Reason'];
  const rows = errors.map((e) => [
    e.row ?? '',
    e.field || '',
    e.message || e.reason || 'Import failed',
  ]);
  const buf = workbookBuffer(headers, rows, {
    sheetName: 'Failed rows',
    colWidths: [10, 18, 60],
  });
  fs.writeFileSync(absolutePath, buf);

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
      absolutePath,
      importType: opts.importType || 'IMPORT',
      sourceFileName: opts.sourceFileName || '',
      errorRows: errors.length,
      totalRows,
      successRows,
      downloadPath: null, // filled after we know notification id
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

export function resolveImportErrorReportPath(meta) {
  if (!meta?.reportId) return null;
  const absolutePath = path.join(importErrorReportRoot, `${meta.reportId}.xlsx`);
  if (!fs.existsSync(absolutePath)) {
    if (meta.absolutePath && fs.existsSync(meta.absolutePath)) return meta.absolutePath;
    return null;
  }
  return absolutePath;
}
