import multer from 'multer';
import XLSX from 'xlsx';
import { asyncHandler, AppError } from './helpers.js';
import { sendExcel } from './excelExport.js';

export const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export function parseSheetRows(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
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
    path,
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
    rowFromDoc,
    sampleRows = [],
    importColumns,
    sort = 'name',
  } = excel;

  router.get(
    `/${path}/export`,
    canRead,
    asyncHandler(async (_req, res) => {
      const rows = await Model.find({ isDeleted: false, ...(listFilter || {}) }).sort(sort);
      const dataRows = rows.map((doc) => rowFromDoc(doc.toObject ? doc.toObject() : doc));
      sendExcel(res, filename, headers, dataRows, { sheetName });
    })
  );

  router.get(
    `/${path}/sample`,
    canRead,
    asyncHandler(async (_req, res) => {
      const sampleName = String(filename || 'master.xlsx').replace(/\.xlsx$/i, '_Sample.xlsx');
      sendExcel(res, sampleName, headers, sampleRows, { sheetName });
    })
  );

  if (!importColumns?.length || !createFromImport) return;

  router.post(
    `/${path}/import`,
    canImport,
    excelUpload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new AppError('Excel file required', 400, 'VALIDATION_ERROR');
      const rows = parseSheetRows(req.file.buffer);
      const errors = [];
      let created = 0;
      let updated = 0;

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
