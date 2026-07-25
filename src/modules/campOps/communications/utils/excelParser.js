import XLSX from 'xlsx';

export function parseExcelBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('Excel file has no sheets');
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (!matrix.length) {
    throw new Error('Excel sheet is empty');
  }

  const headers = matrix[0].map((header, index) => {
    const value = String(header || '').trim();
    return value || `Column ${index + 1}`;
  });

  const rows = matrix
    .slice(1)
    .filter((row) => row.some((cell) => String(cell || '').trim()))
    .map((row) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = row[index] ?? '';
      });
      return record;
    });

  return {
    sheetName,
    headers,
    rows,
    sampleRows: rows.slice(0, 5),
  };
}
