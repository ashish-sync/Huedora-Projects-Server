import XLSX from 'xlsx';

/**
 * Build an .xlsx buffer from header + row arrays.
 * @param {string[]} headers
 * @param {Array<Array<string|number|null|undefined>>} rows
 * @param {{ sheetName?: string, colWidths?: number[] }} [opts]
 */
export function workbookBuffer(headers, rows, opts = {}) {
  const wb = XLSX.utils.book_new();
  appendSheet(wb, headers, rows, opts);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * @param {Array<{ name: string, headers: string[], rows: any[][], colWidths?: number[] }>} sheets
 */
export function multiSheetBuffer(sheets) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    appendSheet(wb, sheet.headers, sheet.rows, {
      sheetName: sheet.name,
      colWidths: sheet.colWidths,
    });
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
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

export function sendMultiSheetExcel(res, filename, sheets) {
  const buf = multiSheetBuffer(sheets);
  sendBuffer(res, filename, buf);
}
