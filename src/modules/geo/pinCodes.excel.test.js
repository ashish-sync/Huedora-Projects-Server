import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePinCodesCell,
  expandPinGeographyImportRow,
  pinsToGroupedExcelRows,
  PIN_CODE_IMPORT_HEADERS,
  PIN_CODE_SAMPLE_ROWS,
} from './pinCodes.excel.js';

test('PIN Geography sample uses State, District, Pin Codes', () => {
  assert.deepEqual(PIN_CODE_IMPORT_HEADERS, ['State', 'District', 'Pin Codes']);
  assert.equal(PIN_CODE_SAMPLE_ROWS[0][0], 'Andhra Pradesh');
  assert.equal(PIN_CODE_SAMPLE_ROWS[0][1], 'Alluri Sitharama Raju');
  assert.match(String(PIN_CODE_SAMPLE_ROWS[0][2]), /531024/);
});

test('parsePinCodesCell splits comma-separated PINs and ignores junk', () => {
  assert.deepEqual(
    parsePinCodesCell('531024, 531025, 531026, 53'),
    ['531024', '531025', '531026'],
  );
  assert.deepEqual(
    parsePinCodesCell('110001;110001|110002'),
    ['110001', '110002'],
  );
  assert.deepEqual(parsePinCodesCell(''), []);
});

test('expandPinGeographyImportRow expands Pin Codes into one payload per PIN', () => {
  const rows = expandPinGeographyImportRow({
    State: 'Delhi',
    District: 'New Delhi',
    'Pin Codes': '110001, 110002',
  }, { rowNum: 2 });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.pinCode), ['110001', '110002']);
  assert.equal(rows[0].stateName, 'Delhi');
  assert.equal(rows[0].districtName, 'New Delhi');
  assert.equal(rows[0].rowNum, 2);
});

test('expandPinGeographyImportRow still accepts legacy one-PIN-per-row files', () => {
  const rows = expandPinGeographyImportRow({
    'PIN Code': '400001',
    State: 'Maharashtra',
    District: 'Mumbai City',
  }, { rowNum: 5 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pinCode, '400001');
});

test('pinsToGroupedExcelRows groups PINs by state and district', () => {
  const grouped = pinsToGroupedExcelRows([
    { pinCode: '110002', stateName: 'Delhi', districtName: 'New Delhi' },
    { pinCode: '110001', stateName: 'Delhi', districtName: 'New Delhi' },
    { pinCode: '400001', stateName: 'Maharashtra', districtName: 'Mumbai City' },
  ]);
  assert.deepEqual(grouped, [
    ['Delhi', 'New Delhi', '110002, 110001'],
    ['Maharashtra', 'Mumbai City', '400001'],
  ]);
});
