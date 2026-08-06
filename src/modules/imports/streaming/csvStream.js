import fs from 'fs';
import { createInterface } from 'readline';
import { MAX_IMPORT_ROWS } from '../../../utils/spreadsheetLimits.js';
import { importAppError } from '../../../utils/importErrors.js';
import { detectCsvStreamEncoding, stripUtf8Bom } from '../../../utils/csvEncoding.js';

/** Parse one CSV line with quoted-field support (single-line fields). */
export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function rowObject(headers, cells) {
  const record = {};
  for (let i = 0; i < headers.length; i++) {
    record[headers[i]] = cells[i] ?? '';
  }
  return record;
}

/**
 * Async generator: stream CSV from disk, yield { rowNum, record }.
 * Stops with VALIDATION_ERROR if more than maxRows data rows.
 */
export async function* streamCsvFile(filePath, { maxRows = MAX_IMPORT_ROWS } = {}) {
  if (!fs.existsSync(filePath)) {
    throw importAppError('TEMP_MISSING');
  }

  // Prefer UTF-8 (with/without BOM). Excel "Unicode Text" may be UTF-16 LE.
  const encoding = detectCsvStreamEncoding(filePath);
  const rl = createInterface({
    input: fs.createReadStream(filePath, { encoding }),
    crlfDelay: Infinity,
  });

  let headers = null;
  let dataRows = 0;

  try {
    for await (const raw of rl) {
      const line = stripUtf8Bom(String(raw || ''));
      if (!line.trim()) continue;

      const cells = parseCsvLine(line).map((c) => String(c ?? '').trim());

      if (!headers) {
        headers = cells.map((h, i) => h || `Column ${i + 1}`);
        continue;
      }

      dataRows += 1;
      if (dataRows > maxRows) {
        throw importAppError('TOO_MANY_ROWS');
      }

      const hasData = cells.some((c) => c !== '');
      if (!hasData) continue;

      yield {
        rowNum: dataRows + 1,
        record: rowObject(headers, cells),
        headers,
      };
    }
  } finally {
    rl.close();
  }

  if (!headers) {
    throw importAppError('EMPTY_FILE');
  }
}

/** Peek headers + sample without retaining the full file. */
export async function peekCsvMeta(filePath, { sampleSize = 5, maxRows = MAX_IMPORT_ROWS } = {}) {
  const headers = [];
  const sampleRows = [];
  let totalRows = 0;
  for await (const row of streamCsvFile(filePath, { maxRows })) {
    if (!headers.length && row.headers) headers.push(...row.headers);
    totalRows += 1;
    if (sampleRows.length < sampleSize) sampleRows.push(row.record);
  }
  return { headers, sampleRows, totalRows };
}
