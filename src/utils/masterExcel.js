import multer from 'multer';
import path from 'path';
import XLSX from 'xlsx';
import { asyncHandler, AppError } from './helpers.js';
import { sendExcel } from './excelExport.js';
import { logMemory, withMemoryLog } from './memory.js';
import {
  MAX_SPREADSHEET_UPLOAD_BYTES,
  MAX_IMPORT_ROWS,
  MAX_EXPORT_ROWS,
} from './spreadsheetLimits.js';

/**
 * Ephemeral spreadsheet import policy
 * -----------------------------------
 * User uploads .xlsx / .xls / .csv → validate → read workbook in memory →
 * validate rows → import into DB → return import report → discard buffer.
 * Do NOT write the upload, a CSV conversion, or a gzip artifact to disk.
 *
 * Memory: keep uploads small, cap row counts, discard buffers immediately,
 * and never retain the parsed workbook after import.
 */

export { MAX_SPREADSHEET_UPLOAD_BYTES, MAX_IMPORT_ROWS, MAX_EXPORT_ROWS };

const SPREADSHEET_EXT = new Set(['.xlsx', '.xls', '.csv']);
const SPREADSHEET_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/excel',
  'text/csv',
  'application/csv',
  'text/plain',
  'application/octet-stream',
]);

export function assertSpreadsheetUpload(file) {
  if (!file) throw new AppError('Excel or CSV file required', 400, 'VALIDATION_ERROR');
  const ext = path.extname(String(file.originalname || '')).toLowerCase();
  if (!SPREADSHEET_EXT.has(ext)) {
    throw new AppError('Only .xlsx, .xls, or .csv files are accepted', 400, 'VALIDATION_ERROR');
  }
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime && !SPREADSHEET_MIME.has(mime) && !mime.includes('sheet') && !mime.includes('csv')) {
    throw new AppError('Invalid spreadsheet file type', 400, 'VALIDATION_ERROR');
  }
  if (!file.buffer || !Buffer.isBuffer(file.buffer)) {
    throw new AppError('Upload must be processed in memory (no disk storage)', 400, 'VALIDATION_ERROR');
  }
  if (file.buffer.length > MAX_SPREADSHEET_UPLOAD_BYTES) {
    throw new AppError(
      `Spreadsheet exceeds ${Math.round(MAX_SPREADSHEET_UPLOAD_BYTES / (1024 * 1024))}MB limit`,
      400,
      'VALIDATION_ERROR'
    );
  }
  return file;
}

/** Release upload buffer after parse — do not persist original file. */
export function discardUploadBuffer(file) {
  if (file && file.buffer) {
    file.buffer = Buffer.alloc(0);
  }
}

export const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SPREADSHEET_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(String(file.originalname || '')).toLowerCase();
    if (!SPREADSHEET_EXT.has(ext)) {
      return cb(new AppError('Only .xlsx, .xls, or .csv files are accepted', 400, 'VALIDATION_ERROR'));
    }
    return cb(null, true);
  },
});

/**
 * Parse first sheet to row objects. Caps rows to protect heap.
 * Uses sheet_rows bound so XLSX does not materialize unbounded sheets.
 */
export function parseSheetRows(buffer, { maxRows = MAX_IMPORT_ROWS } = {}) {
  const wb = XLSX.read(buffer, {
    type: 'buffer',
    raw: false,
    cellDates: true,
    sheetRows: maxRows + 1, // header + data
  });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  // Drop workbook refs promptly
  wb.Sheets = {};
  wb.SheetNames = [];
  if (rows.length > maxRows) {
    throw new AppError(
      `Import limited to ${maxRows} data rows (file has ${rows.length}+). Split the file and retry.`,
      400,
      'VALIDATION_ERROR'
    );
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
 * Attach GET /export, GET /sample, POST /import to a master CRUD path.
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
      const sampleName = String(filename || 'master.xlsx').replace(/\.xlsx$/i, '_Sample.xlsx');
      sendExcel(res, sampleName, sampleColumnHeaders, sampleRows, { sheetName });
    })
  );

  if (!importColumns?.length || !createFromImport) return;

  router.post(
    `/${routePath}/import`,
    canImport,
    excelUpload.single('file'),
    asyncHandler(async (req, res) => {
      assertSpreadsheetUpload(req.file);
      logMemory(`import:${routePath}:start`, { bytes: req.file.buffer?.length || 0 });
      const rows = parseSheetRows(req.file.buffer);
      discardUploadBuffer(req.file);

      const errors = [];
      let created = 0;
      let updated = 0;
      const BATCH = 100;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        const hasData = Object.values(row).some((v) => String(v ?? '').trim() !== '');
        if (!hasData) continue;
        try {
          const body = rowToBody(row, importColumns);
          const result = await createFromImport(body, req);
          if (result?.updated) updated += 1;
          else created += 1;
        } catch (err) {
          errors.push({
            row: rowNum,
            field: 'import',
            message: err.message || 'Import failed',
          });
        }
        // Allow GC between batches on large imports
        if (i > 0 && i % BATCH === 0) {
          rows[i] = null;
        }
      }

      if (writeAudit && entityType) {
        await writeAudit({
          actorId: req.user._id,
          actorEmail: req.user.email,
          action: `${entityType}.IMPORT`,
          entityType,
          after: { created, updated, errors: errors.length, fileName: req.file.originalname },
          requestId: req.requestId,
        });
      }

      logMemory(`import:${routePath}:done`, { created, updated, errorRows: errors.length });
      res.json({
        data: {
          totalRows: rows.length,
          created,
          updated,
          errorRows: errors.length,
          errors: errors.slice(0, 200),
        },
      });
    })
  );
}

export function importResultResponse(res, { rows, created, updated, errors, fileName, entityType }) {
  res.json({
    data: {
      totalRows: rows.length,
      created,
      updated,
      errorRows: errors.length,
      errors: errors.slice(0, 200),
      entityType,
      fileName,
    },
  });
}
