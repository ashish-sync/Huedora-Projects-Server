import path from 'path';
import XLSX from 'xlsx';
import { asyncHandler, AppError } from './helpers.js';
import { sendCsv, sendExcel } from './excelExport.js';
import { logMemory, withMemoryLog } from './memory.js';
import {
  MAX_SPREADSHEET_UPLOAD_BYTES,
  MAX_IMPORT_ROWS,
  MAX_EXPORT_ROWS,
  IMPORT_ACCEPT_EXTENSIONS,
  IMPORT_BATCH_SIZE,
} from './spreadsheetLimits.js';
import { importRateLimiter } from '../middleware/importRateLimit.js';
import {
  tabularImportUpload,
  validateUploadedImportFile,
  safeUnlink,
  assertImportExtension,
} from '../modules/imports/streaming/tempUpload.js';
import { executeUploadedImport } from '../modules/imports/streaming/runStreamingImport.js';
import { importAppError } from './importErrors.js';

/**
 * Scalable tabular import policy
 * ------------------------------
 * Upload .csv (primary) or .xlsb → validate → save temp → stream read →
 * validate rows → batch insert (500) → clear batch memory → summary → delete temp.
 * Never load an entire oversized workbook into heap. Samples are CSV-only.
 * Bulk exports may still use Excel.
 */

export {
  MAX_SPREADSHEET_UPLOAD_BYTES,
  MAX_IMPORT_ROWS,
  MAX_EXPORT_ROWS,
  IMPORT_ACCEPT_EXTENSIONS,
  IMPORT_BATCH_SIZE,
};

export function sampleCsvFilename(name) {
  const base = String(name || 'master')
    .replace(/\.xlsx$/i, '')
    .replace(/\.xlsb$/i, '')
    .replace(/\.csv$/i, '')
    .replace(/_Sample$/i, '');
  return `${base}_Sample.csv`;
}

/** @deprecated Prefer validateUploadedImportFile — kept for callers checking memory uploads. */
export function assertSpreadsheetUpload(file) {
  if (file?.path) return validateUploadedImportFile(file);
  if (!file) throw importAppError('FILE_REQUIRED');
  assertImportExtension(file.originalname || '');
  if (file.buffer && file.buffer.length > MAX_SPREADSHEET_UPLOAD_BYTES) {
    throw importAppError('TOO_LARGE');
  }
  return file;
}

/** @deprecated No-op for disk uploads; unlinks path if present. */
export function discardUploadBuffer(file) {
  if (file?.buffer) file.buffer = Buffer.alloc(0);
  if (file?.path) safeUnlink(file.path);
}

/** Disk-based upload middleware (CSV / XLSB → import-temp). */
export const excelUpload = tabularImportUpload;

/**
 * Legacy in-memory parse (prefer streaming). Still capped at MAX_IMPORT_ROWS.
 */
export function parseSheetRows(buffer, { maxRows = MAX_IMPORT_ROWS } = {}) {
  const wb = XLSX.read(buffer, {
    type: 'buffer',
    raw: false,
    cellDates: true,
    sheetRows: maxRows + 2,
  });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  wb.Sheets = {};
  wb.SheetNames = [];
  if (rows.length > maxRows) {
    throw importAppError('TOO_MANY_ROWS');
  }
  return rows;
}

export function cellValue(row, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const n of list) {
    if (row[n] !== undefined && String(row[n]).trim() !== '') return String(row[n]).trim();
  }
  const keys = Object.keys(row);
  for (const name of list) {
    const want = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
    const hit = keys.find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, '') === want);
    if (hit && String(row[hit]).trim() !== '') return String(row[hit]).trim();
  }
  return '';
}

function parseBool(value, fallback = true) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return fallback;
  if (['yes', 'y', 'true', '1', 'active'].includes(v)) return true;
  if (['no', 'n', 'false', '0', 'inactive'].includes(v)) return false;
  return fallback;
}

function rowToBody(row, importColumns) {
  const body = {};
  for (const col of importColumns) {
    const raw = cellValue(row, col.labels || [col.label || col.field]);
    if (!raw && col.optional) continue;
    if (col.type === 'bool') {
      body[col.field] = parseBool(raw, col.defaultValue !== undefined ? col.defaultValue : true);
    } else if (col.type === 'number') {
      const n = Number(String(raw).replace(/,/g, ''));
      body[col.field] = Number.isFinite(n) ? n : col.defaultValue ?? 0;
    } else {
      body[col.field] = raw;
    }
    if (col.required && !String(body[col.field] ?? '').trim()) {
      throw new AppError(`${col.labels?.[0] || col.field} is required`, 400, 'VALIDATION_ERROR');
    }
  }
  return body;
}

/**
 * Attach GET /export, GET /sample, POST /import.
 * Import: rate-limited streaming CSV/XLSB with batch inserts + temp cleanup.
 */
export function attachMasterExcelRoutes(router, opts) {
  const {
    path: routePath,
    Model,
    listFilter = null,
    excel,
    canRead,
    canImport,
    createFromImport,
    entityType,
    writeAudit,
  } = opts;

  if (!excel?.headers?.length) return;

  const {
    filename,
    sheetName = 'Master',
    headers,
    sampleHeaders,
    rowFromDoc,
    prepareExportDocs,
    sampleRows = [],
    importColumns,
    sort = 'name',
  } = excel;
  const sampleColumnHeaders = sampleHeaders?.length ? sampleHeaders : headers;

  router.get(
    `/${routePath}/export`,
    canRead,
    asyncHandler(async (_req, res) => {
      await withMemoryLog(`export:${routePath}`, async () => {
        let docs = (
          await Model.find({ isDeleted: false, ...(listFilter || {}) })
            .sort(sort)
            .limit(MAX_EXPORT_ROWS)
        ).map((doc) => (doc.toObject ? doc.toObject() : doc));
        if (typeof prepareExportDocs === 'function') {
          docs = await prepareExportDocs(docs);
        }
        const dataRows = docs.map((doc) => rowFromDoc(doc));
        docs = null;
        sendExcel(res, filename, headers, dataRows, { sheetName });
      });
    })
  );

  router.get(
    `/${routePath}/sample`,
    canRead,
    asyncHandler(async (_req, res) => {
      sendCsv(res, sampleCsvFilename(filename), sampleColumnHeaders, sampleRows);
    })
  );

  if (!importColumns?.length || !createFromImport) return;

  router.post(
    `/${routePath}/import`,
    canImport,
    importRateLimiter,
    excelUpload.single('file'),
    asyncHandler(async (req, res) => {
      const { job, summary } = await executeUploadedImport({
        file: req.file,
        userId: req.user?._id,
        importType: entityType || routePath,
        processRow: async ({ rowNum, record }) => {
          const hasData = Object.values(record).some((v) => String(v ?? '').trim() !== '');
          if (!hasData) return { skipped: true };
          const body = rowToBody(record, importColumns);
          const result = await createFromImport(body, req);
          if (result?.updated) return { updated: true };
          return { ok: true };
        },
      });

      if (writeAudit && entityType) {
        await writeAudit({
          actorId: req.user._id,
          actorEmail: req.user.email,
          action: `${entityType}.IMPORT`,
          entityType,
          after: {
            created: summary.created,
            updated: summary.updated,
            errors: summary.errorRows,
            fileName: summary.fileName,
            jobId: job?._id,
          },
          requestId: req.requestId,
        });
      }

      logMemory(`import:${routePath}:response`, {
        created: summary.created,
        updated: summary.updated,
        errorRows: summary.errorRows,
      });

      res.json({
        data: {
          jobId: job?._id,
          status: job?.status || 'SUCCEEDED',
          percent: job?.percent ?? 100,
          totalRows: summary.totalRows,
          created: summary.created,
          updated: summary.updated,
          skipped: summary.skipped,
          errorRows: summary.errorRows,
          errors: summary.errors,
        },
      });
    })
  );
}

export function importResultResponse(res, { rows, created, updated, errors, fileName, entityType, jobId }) {
  res.json({
    data: {
      jobId: jobId || null,
      totalRows: Array.isArray(rows) ? rows.length : Number(rows) || 0,
      created,
      updated,
      errorRows: errors.length,
      errors: errors.slice(0, 200),
      entityType,
      fileName,
    },
  });
}
