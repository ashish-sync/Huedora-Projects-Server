import fs from 'fs';
import { createInterface } from 'readline';
import { MAX_IMPORT_ROWS } from '../../../utils/spreadsheetLimits.js';
import { importAppError } from '../../../utils/importErrors.js';
import { detectCsvStreamEncoding, stripUtf8Bom } from '../../../utils/csvEncoding.js';

/** Supported field separators for auto-detection (EU Excel often uses `;`). */
export const CSV_CANDIDATE_DELIMITERS = [',', ';', '\t'];

const DELIMITER_PROBE_BYTES = 16384;
const DELIMITER_PROBE_LINES = 12;

/**
 * Parse one CSV line with quoted-field support (single-line fields).
 * @param {string} line
 * @param {string} [delimiter=',']
 */
export function parseCsvLine(line, delimiter = ',') {
  const delim = delimiter || ',';
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
    } else if (ch === delim) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Score candidate delimiters on sample text so semicolon/tab files do not
 * collapse into a single cell (classic Excel EU / TSV failure mode).
 * @param {string} text
 * @param {{ candidates?: string[] }} [opts]
 * @returns {string}
 */
export function detectCsvDelimiter(text, { candidates = CSV_CANDIDATE_DELIMITERS } = {}) {
  const lines = String(text || '')
    .split(/\r\n|\n|\r/)
    .map((l) => stripUtf8Bom(String(l || '')))
    .filter((l) => l.trim())
    .slice(0, DELIMITER_PROBE_LINES);

  if (!lines.length) return ',';

  let best = ',';
  let bestScore = -1;

  for (const delim of candidates) {
    const counts = lines.map((line) => parseCsvLine(line, delim).length);
    const columns = counts[0] || 0;
    if (columns < 2) continue;

    let variance = 0;
    let consistent = true;
    for (const c of counts) {
      variance += Math.abs(c - columns);
      if (c !== columns) consistent = false;
    }

    // Prefer more columns, then consistency across probe rows.
    const score = columns * 1000 + (consistent ? 250 : 0) - variance * 15;
    if (score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }

  return bestScore < 0 ? ',' : best;
}

/** Human label for UI / diagnostics. */
export function csvDelimiterLabel(delimiter) {
  if (delimiter === ';') return 'semicolon';
  if (delimiter === '\t') return 'tab';
  return 'comma';
}

function readCsvProbeText(filePath, encoding) {
  const probe = Buffer.alloc(DELIMITER_PROBE_BYTES);
  let n = 0;
  const fd = fs.openSync(filePath, 'r');
  try {
    n = fs.readSync(fd, probe, 0, DELIMITER_PROBE_BYTES, 0);
  } finally {
    fs.closeSync(fd);
  }
  return stripUtf8Bom(probe.slice(0, n).toString(encoding));
}

function rowObject(headers, cells) {
  const record = {};
  for (let i = 0; i < headers.length; i++) {
    record[headers[i]] = cells[i] ?? '';
  }
  return record;
}

/**
 * Async generator: stream CSV from disk, yield { rowNum, record, headers, delimiter }.
 * Stops with VALIDATION_ERROR if more than maxRows data rows.
 */
export async function* streamCsvFile(filePath, { maxRows = MAX_IMPORT_ROWS, delimiter: forcedDelimiter } = {}) {
  if (!fs.existsSync(filePath)) {
    throw importAppError('TEMP_MISSING');
  }

  // Prefer UTF-8 (with/without BOM). Excel "Unicode Text" may be UTF-16 LE.
  const encoding = detectCsvStreamEncoding(filePath);
  const delimiter =
    forcedDelimiter ||
    detectCsvDelimiter(readCsvProbeText(filePath, encoding));

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

      const cells = parseCsvLine(line, delimiter).map((c) => String(c ?? '').trim());

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
        delimiter,
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
  let delimiter = ',';
  for await (const row of streamCsvFile(filePath, { maxRows })) {
    if (!headers.length && row.headers) headers.push(...row.headers);
    if (row.delimiter) delimiter = row.delimiter;
    totalRows += 1;
    if (sampleRows.length < sampleSize) sampleRows.push(row.record);
  }
  return { headers, sampleRows, totalRows, delimiter, delimiterLabel: csvDelimiterLabel(delimiter) };
}
