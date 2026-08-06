/**
 * Tabular import limits — keep client `importFilePolicy.js` in sync.
 * CSV primary, XLSB secondary. Never load an entire oversized file into heap.
 */
export const MAX_SPREADSHEET_UPLOAD_BYTES = 3 * 1024 * 1024; // 3 MB
export const MAX_IMPORT_ROWS = 1_000;
export const IMPORT_BATCH_SIZE = 500;
export const MAX_EXPORT_ROWS = 10_000;
export const MAX_CAMP_EXPORT_ROWS = 5_000;
export const MAX_PREVIEW_BODY_ROWS = 1_000;

/** Accepted import extensions (samples remain CSV-only). */
export const IMPORT_ACCEPT_EXTENSIONS = ['.csv', '.xlsb'];
export const IMPORT_ACCEPT_ATTR = '.csv,.xlsb,text/csv,application/vnd.ms-excel.sheet.binary.macroEnabled.12';
export const IMPORT_ACCEPT_HINT =
  'Supported: .csv (preferred) or .xlsb · max 1,000 rows · max 3 MB. Save Excel as CSV before upload.';
