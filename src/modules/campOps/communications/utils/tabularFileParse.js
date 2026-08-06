import fs from 'fs';
import path from 'path';
import { MAX_IMPORT_ROWS } from '../../../../utils/spreadsheetLimits.js';
import { importAppError } from '../../../../utils/importErrors.js';
import { streamCsvFile } from '../../../imports/streaming/csvStream.js';
import { streamXlsbFile } from '../../../imports/streaming/xlsbStream.js';

/**
 * Stream CSV/XLSB from disk into a capped row list (≤ MAX_IMPORT_ROWS).
 * Used by camp parse paths that need headers + rows for mapping UI.
 */
export async function parseTabularFile(filePath, { maxRows = MAX_IMPORT_ROWS, originalName = '' } = {}) {
  const ext = path.extname(String(originalName || filePath)).toLowerCase();
  if (ext !== '.csv' && ext !== '.xlsb') {
    throw importAppError('BAD_EXTENSION');
  }

  const stream =
    ext === '.xlsb'
      ? streamXlsbFile(filePath, { maxRows })
      : streamCsvFile(filePath, { maxRows });

  const rows = [];
  let headers = [];

  for await (const row of stream) {
    if (row.headers?.length && !headers.length) headers = row.headers;
    rows.push(row.record);
  }

  if (!headers.length && !rows.length) {
    throw importAppError('EMPTY_FILE');
  }

  return {
    sheetName: ext === '.xlsb' ? 'Sheet1' : 'CSV',
    headers,
    rows,
    sampleRows: rows.slice(0, 5),
    totalRows: rows.length,
  };
}

export function safeUnlinkImport(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}
