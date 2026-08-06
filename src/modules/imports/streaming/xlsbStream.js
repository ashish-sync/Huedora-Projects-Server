import fs from 'fs';
import XLSX from 'xlsx';
import { MAX_IMPORT_ROWS } from '../../../utils/spreadsheetLimits.js';
import { importAppError } from '../../../utils/importErrors.js';

/**
 * Read XLSB from disk with a hard sheetRows bound so we never materialize
 * more than maxRows + header. Yields row objects like the CSV stream.
 */
export async function* streamXlsbFile(filePath, { maxRows = MAX_IMPORT_ROWS } = {}) {
  if (!fs.existsSync(filePath)) {
    throw importAppError('TEMP_MISSING');
  }

  // sheetRows = header + maxRows + 1 sentinel to detect overflow
  const wb = XLSX.readFile(filePath, {
    type: 'file',
    cellDates: true,
    raw: false,
    sheetRows: maxRows + 2,
  });

  try {
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw importAppError('EMPTY_FILE');
    const sheet = wb.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

    if (!matrix.length) throw importAppError('EMPTY_FILE');

    const headers = matrix[0].map((h, i) => {
      const v = String(h || '').trim();
      return v || `Column ${i + 1}`;
    });

    const data = matrix.slice(1);
    wb.Sheets = {};
    wb.SheetNames = [];
    matrix.length = 0;

    if (data.length > maxRows) {
      throw importAppError('TOO_MANY_ROWS');
    }

    let dataRows = 0;
    for (const cells of data) {
      const hasData = (cells || []).some((c) => String(c ?? '').trim() !== '');
      if (!hasData) continue;
      dataRows += 1;
      const record = {};
      headers.forEach((h, i) => {
        record[h] = cells[i] == null ? '' : String(cells[i]).trim();
      });
      yield { rowNum: dataRows + 1, record, headers };
    }

    if (!dataRows) throw importAppError('NO_DATA_ROWS');
  } finally {
    try {
      wb.Sheets = {};
      wb.SheetNames = [];
    } catch {
      /* ignore */
    }
  }
}
