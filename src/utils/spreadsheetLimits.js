/**
 * Tabular import limits — keep client `importFilePolicy.js` in sync.
 * CSV preferred; Excel workbooks (.xlsx/.xls) and XLSB also accepted.
 * Cap upload size + row count so we never load oversized files into heap.
 */
export const MAX_SPREADSHEET_UPLOAD_BYTES = 3 * 1024 * 1024; // 3 MB
export const MAX_IMPORT_ROWS = 1_000;
export const IMPORT_BATCH_SIZE = 500;
export const MAX_EXPORT_ROWS = 10_000;
export const MAX_CAMP_EXPORT_ROWS = 5_000;
export const MAX_PREVIEW_BODY_ROWS = 1_000;

/** Accepted import extensions (download samples remain CSV-only). */
export const IMPORT_ACCEPT_EXTENSIONS = ['.csv', '.xlsx', '.xls', '.xlsb'];
export const IMPORT_ACCEPT_ATTR =
  '.csv,.xlsx,.xls,.xlsb,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.binary.macroEnabled.12';
export const IMPORT_ACCEPT_HINT =
  'Supported: .csv UTF-8 (preferred), .xlsx, .xls, or .xlsb · max 1,000 rows · max 3 MB.';
