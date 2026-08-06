import XLSX from 'xlsx';
import { MAX_IMPORT_ROWS } from '../../../../utils/spreadsheetLimits.js';
import { importAppError } from '../../../../utils/importErrors.js';

export function parseExcelBuffer(buffer, { maxRows = MAX_IMPORT_ROWS } = {}) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,
      raw: false,
      sheetRows: maxRows + 1,
    });
  } catch {
    throw importAppError('PARSE_FAILED');
  }
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw importAppError('EMPTY_FILE');
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  workbook.Sheets = {};
  workbook.SheetNames = [];

  if (!matrix.length) {
    throw importAppError('EMPTY_FILE');
  }

  const headers = matrix[0].map((header, index) => {
    const value = String(header || '').trim();
    return value || `Column ${index + 1}`;
  });

  const dataMatrix = matrix.slice(1);
  // Release header+matrix peak early
  matrix.length = 0;

  if (dataMatrix.length > maxRows) {
    throw importAppError('TOO_MANY_ROWS');
  }

  const rows = dataMatrix
    .filter((row) => row.some((cell) => String(cell || '').trim()))
    .map((row) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = row[index] ?? '';
      });
      return record;
    });

  if (!rows.length) {
    throw importAppError('NO_DATA_ROWS');
  }

  return {
    sheetName,
    headers,
    rows,
    sampleRows: rows.slice(0, 5),
    totalRows: rows.length,
  };
}
