/**
 * Camp One import / paste validation matrix.
 * Run: node scripts/test-camp-import-validation.js
 */
import { validateMappedImportRows } from '../src/modules/campOps/campOps.helpers.js';
import { matchImportColumns } from '../src/modules/campOps/import/importColumnMatcher.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const validRow = {
  source: 'excel',
  clientName: 'Acme Pharma',
  campaignType: 'Cardio',
  campaignName: 'BMD',
  campDate: '2026-07-22',
  startTime: '09:00',
  endTime: '12:00',
  doctorName: 'Dr Sharma',
  doctorCode: 'D001',
  campAddress: '12 MG Road',
  pincode: '560001',
  state: 'Karnataka',
  district: 'Bengaluru Urban',
  city: 'Bengaluru',
  hq: 'Bengaluru',
  zone: 'South Zone',
  expectedPatients: 50,
  fieldPersonName: 'Ravi Kumar',
  fieldPersonPhone: '9876543210',
  remarks: 'Morning camp',
};

const cases = [
  {
    name: 'valid complete row',
    rows: [validRow],
    expectValid: 1,
    expectInvalid: 0,
  },
  {
    name: 'missing client name',
    rows: [{ ...validRow, clientName: '' }],
    expectValid: 0,
    expectInvalid: 1,
    expectErrorIncludes: 'Client name is required',
  },
  {
    name: 'invalid camp date',
    rows: [{ ...validRow, campDate: 'not-a-date' }],
    expectValid: 0,
    expectInvalid: 1,
    expectErrorIncludes: 'Camp date is invalid',
  },
  {
    name: 'invalid pincode',
    rows: [{ ...validRow, pincode: '12345' }],
    expectValid: 0,
    expectInvalid: 1,
    expectErrorIncludes: '6-digit pin code',
  },
  {
    name: 'zone mismatch for state',
    rows: [{ ...validRow, zone: 'North Zone' }],
    expectValid: 0,
    expectInvalid: 1,
    expectErrorIncludes: 'Zone must be',
  },
  {
    name: 'incomplete location block',
    rows: [{
      ...validRow,
      district: '',
      city: '',
      hq: '',
      fieldPersonName: '',
      fieldPersonPhone: '',
      expectedPatients: 0,
    }],
    expectValid: 0,
    expectInvalid: 1,
  },
  {
    name: 'variant doctor headers map to name and code',
    run: () => {
      const result = matchImportColumns(['Doctor Name', 'Doctor_Code', 'Camp Date']);
      assert(result.mapping.doctorName === 'Doctor Name', 'doctorName should map from Doctor Name');
      assert(result.mapping.doctorCode === 'Doctor_Code', 'doctorCode should map from Doctor_Code');
      assert(result.mapping.campDate === 'Camp Date', 'campDate should map');
    },
  },
];

let passed = 0;
let failed = 0;

for (const testCase of cases) {
  try {
    if (testCase.run) {
      testCase.run();
    } else {
      const { validRows, invalidRows } = validateMappedImportRows(testCase.rows, { source: 'excel' });
      assert(validRows.length === testCase.expectValid, `expected ${testCase.expectValid} valid, got ${validRows.length}`);
      assert(invalidRows.length === testCase.expectInvalid, `expected ${testCase.expectInvalid} invalid, got ${invalidRows.length}`);
      if (testCase.expectErrorIncludes) {
        const errors = invalidRows[0]?.errors || [];
        assert(
          errors.some((err) => String(err).includes(testCase.expectErrorIncludes)),
          `expected error containing "${testCase.expectErrorIncludes}", got: ${errors.join('; ')}`,
        );
      }
    }
    passed += 1;
    console.log(`PASS  ${testCase.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${testCase.name}: ${error.message}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
