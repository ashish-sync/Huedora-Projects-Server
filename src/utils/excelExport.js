import XLSX from 'xlsx';
import { MAX_EXPORT_ROWS } from './spreadsheetLimits.js';

/**
 * Build an .xlsx buffer from header + row arrays.
 * Caps rows to protect Render heap (XLSX materializes the full workbook).
 * @param {string[]} headers
 * @param {Array<Array<string|number|null|undefined>>} rows
 * @param {{ sheetName?: string, colWidths?: number[] }} [opts]
 */
export function workbookBuffer(headers, rows, opts = {}) {
  const capped = (rows || []).slice(0, MAX_EXPORT_ROWS);
  const wb = XLSX.utils.book_new();
  appendSheet(wb, headers, capped, opts);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  wb.Sheets = {};
  wb.SheetNames = [];
  return buf;
}

/**
 * @param {Array<{ name: string, headers: string[], rows: any[][], colWidths?: number[] }>} sheets
 */
export function multiSheetBuffer(sheets) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    appendSheet(wb, sheet.headers, (sheet.rows || []).slice(0, MAX_EXPORT_ROWS), {
      sheetName: sheet.name,
      colWidths: sheet.colWidths,
    });
  }
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  wb.Sheets = {};
  wb.SheetNames = [];
  return buf;
}

function appendSheet(wb, headers, rows, opts = {}) {
  const aoa = [headers, ...(rows || []).map((r) => headers.map((_, i) => (r[i] == null ? '' : r[i])))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (opts.colWidths?.length) {
    ws['!cols'] = opts.colWidths.map((wch) => ({ wch }));
  } else {
    ws['!cols'] = headers.map((h) => ({ wch: Math.min(36, Math.max(12, String(h).length + 4)) }));
  }
  XLSX.utils.book_append_sheet(wb, ws, (opts.sheetName || 'Master').slice(0, 31));
}

function sendBuffer(res, filename, buf) {
  const safe = String(filename || 'export.xlsx').replace(/[^\w.\- ]+/g, '_');
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  res.send(buf);
}

/** Send workbook as a downloadable attachment. */
export function sendExcel(res, filename, headers, rows, opts = {}) {
  const buf = workbookBuffer(headers, rows, opts);
  sendBuffer(res, filename, buf);
}

export function csvBuffer(headers, rows) {
  const escapeCell = (value) => {
    const text = value == null ? '' : String(value);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const capped = (rows || []).slice(0, MAX_EXPORT_ROWS);
  const lines = [
    headers.map(escapeCell).join(','),
    ...capped.map((row) => headers.map((_, index) => escapeCell(row[index])).join(',')),
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

/**
 * Stream CSV without holding the full output string for large exports.
 * `rowIterator` yields row arrays (same shape as sendCsv rows).
 */
export function sendCsvStream(res, filename, headers, rowIterator) {
  const safe = String(filename || 'export.csv').replace(/[^\w.\- ]+/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);

  const escapeCell = (value) => {
    const text = value == null ? '' : String(value);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };

  res.write(`${headers.map(escapeCell).join(',')}\r\n`);
  let count = 0;
  for (const row of rowIterator) {
    if (count >= MAX_EXPORT_ROWS) break;
    res.write(`${headers.map((_, index) => escapeCell(row[index])).join(',')}\r\n`);
    count += 1;
  }
  res.end();
}

export function sendCsv(res, filename, headers, rows) {
  const safe = String(filename || 'export.csv').replace(/[^\w.\- ]+/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  res.send(csvBuffer(headers, rows));
}

export function sendMultiSheetExcel(res, filename, sheets) {
  const buf = multiSheetBuffer(sheets);
  sendBuffer(res, filename, buf);
}
