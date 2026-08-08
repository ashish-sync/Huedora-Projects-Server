import path from 'path';
import {
  MAX_SPREADSHEET_UPLOAD_BYTES,
  MAX_IMPORT_ROWS,
  IMPORT_ACCEPT_EXTENSIONS,
} from './spreadsheetLimits.js';
import { AppError } from './helpers.js';

const MB = Math.round(MAX_SPREADSHEET_UPLOAD_BYTES / (1024 * 1024));
const EXT_LIST = IMPORT_ACCEPT_EXTENSIONS.join(', ');

/** Canonical one-line messages for tabular import / upload failures. */
export const IMPORT_ERROR = {
  FILE_REQUIRED: `Please choose a file to import (.csv, .xlsx, .xls, or .xlsb). Maximum ${MAX_IMPORT_ROWS.toLocaleString()} rows and ${MB} MB.`,
  BAD_EXTENSION: `This file type is not supported for import. Use a .csv UTF-8 file (preferred), or an Excel workbook (.xlsx / .xls / .xlsb).`,
  EMPTY_FILE: `This file has no data rows to import. Download the sample CSV, add up to ${MAX_IMPORT_ROWS.toLocaleString()} rows under the header, and try again.`,
  TOO_LARGE: `This file is larger than ${MB} MB. Reduce the file (max ${MAX_IMPORT_ROWS.toLocaleString()} rows) and upload again.`,
  TOO_MANY_ROWS: `Import is limited to ${MAX_IMPORT_ROWS.toLocaleString()} data rows. This file has more than that — split it into smaller files and import each one separately.`,
  TEMP_MISSING: `The upload did not finish saving before processing started. Please choose the file again and retry the import.`,
  NO_DATA_ROWS: `No usable data rows were found after the header. Check that your file matches the sample column headers and contains at least one filled row.`,
  NO_VALID_ROWS: `None of the rows could be imported. Fix the issues shown for each row (or download the error report), then upload the file again.`,
  RATE_LIMIT: `Too many imports were started in a short time. Wait a few minutes, then try again with a .csv or Excel file.`,
  PARSE_FAILED: `The file could not be read. Re-save it as CSV UTF-8 or a standard Excel workbook (.xlsx) and try again.`,
  ROWS_MAPPING_REQUIRED: `Import needs both the parsed rows and a column mapping. Upload the file again and map every required column before continuing.`,
  GENERIC: `Import failed. Use a .csv (preferred) or Excel (.xlsx / .xls / .xlsb) file with at most ${MAX_IMPORT_ROWS.toLocaleString()} rows and ${MB} MB, matching the sample headers.`,
};

const SHORT_TO_FRIENDLY = [
  [/only \.csv/i, IMPORT_ERROR.BAD_EXTENSION],
  [/not supported/i, IMPORT_ERROR.BAD_EXTENSION],
  [/file required|csv or xlsb/i, IMPORT_ERROR.FILE_REQUIRED],
  [/file is empty|csv file is empty|empty file|no sheets|sheet is empty/i, IMPORT_ERROR.EMPTY_FILE],
  [/no data rows/i, IMPORT_ERROR.NO_DATA_ROWS],
  [/no valid rows/i, IMPORT_ERROR.NO_VALID_ROWS],
  [/rows and mapping/i, IMPORT_ERROR.ROWS_MAPPING_REQUIRED],
  [/exceeds .+mb|larger than|file too large|limit_file_size/i, IMPORT_ERROR.TOO_LARGE],
  [/limited to \d+ data rows|more than \d+ rows/i, IMPORT_ERROR.TOO_MANY_ROWS],
  [/temp file missing|upload failed/i, IMPORT_ERROR.TEMP_MISSING],
  [/too many imports/i, IMPORT_ERROR.RATE_LIMIT],
  [/unexpected field|unexpected file/i, IMPORT_ERROR.FILE_REQUIRED],
  [/could not be read|parse failed|failed to parse/i, IMPORT_ERROR.PARSE_FAILED],
];

/**
 * Map Multer / short errors to a single clear user-facing sentence.
 */
export function friendlyImportMessage(errOrMessage) {
  if (!errOrMessage) return IMPORT_ERROR.GENERIC;
  const raw =
    typeof errOrMessage === 'string'
      ? errOrMessage
      : errOrMessage.message || errOrMessage.code || '';
  const text = String(raw).trim();
  if (!text) return IMPORT_ERROR.GENERIC;

  // Already a full sentence — keep it
  if (text.length >= 48 && /[.!]/.test(text)) return text;

  const code = errOrMessage.code || errOrMessage.name || '';
  if (code === 'LIMIT_FILE_SIZE' || /LIMIT_FILE_SIZE/i.test(text)) return IMPORT_ERROR.TOO_LARGE;
  if (code === 'LIMIT_UNEXPECTED_FILE' || code === 'LIMIT_FILE_COUNT') return IMPORT_ERROR.FILE_REQUIRED;
  if (code === 'RATE_LIMIT') return IMPORT_ERROR.RATE_LIMIT;

  for (const [re, msg] of SHORT_TO_FRIENDLY) {
    if (re.test(text) || re.test(String(code))) return msg;
  }

  // Short generic words → expand
  if (/^(failed|error|invalid|denied|forbidden|unauthorized)$/i.test(text)) {
    return IMPORT_ERROR.GENERIC;
  }

  // Ensure one clear sentence
  if (text.length < 40 && !/[.!?]$/.test(text)) {
    return `${text}. ${IMPORT_ERROR.GENERIC}`;
  }
  return text;
}

export function importAppError(messageKeyOrText, status = 400, code = 'VALIDATION_ERROR', details) {
  const message =
    IMPORT_ERROR[messageKeyOrText] || friendlyImportMessage(messageKeyOrText);
  const err = new AppError(message, status, code);
  if (details !== undefined) err.details = details;
  return err;
}

/** Client-side / server shared pre-check before upload is stored. */
export function describeImportFileProblem(file) {
  if (!file) return IMPORT_ERROR.FILE_REQUIRED;
  const name = file.originalname || file.name || '';
  const ext = path.extname(String(name)).toLowerCase();
  if (!IMPORT_ACCEPT_EXTENSIONS.includes(ext)) return IMPORT_ERROR.BAD_EXTENSION;
  const size = Number(file.size) || 0;
  if (size <= 0) return IMPORT_ERROR.EMPTY_FILE;
  if (size > MAX_SPREADSHEET_UPLOAD_BYTES) return IMPORT_ERROR.TOO_LARGE;
  return null;
}

export { EXT_LIST, MB as IMPORT_MAX_MB };
