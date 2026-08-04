/**
 * Camp One import / paste validation matrix.
 * Run: node scripts/test-camp-import-validation.js
 */
import { validateMappedImportRows } from '../src/modules/campOps/campOps.helpers.js';
import { matchImportColumns } from '../src/modules/campOps/import/importColumnMatcher.js';
import { getCampImportFields } from '../src/modules/campOps/import/campRequestFieldSchema.js';
import { normalizeImportSource } from '../src/modules/campOps/import/importRowEnrichment.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const EXPECTED_HEADERS = [
  'Source of Request',
  'Client Name',
  'Division / Therapy',
  'Method',
  'Camp Date',
  'Request Date',
  'Camp Start Time',
  'Camp End Time',
  'Doctor Name',
  'Doctor Code',
  'Doctor Type / Specialty',
  'Camp / Clinic Address',
  'PIN Code',
  'City',
  'Expected Patients',
  'Contact Person Level',
  'Contact Person Name',
  'Contact Person Number',
];

const validRow = {
  source: 'excel',
  clientName: 'Acme Pharma',
  campaignType: 'Cardio',
  campaignName: 'BMD',
  campDate: '2026-07-22',
  requestDate: '2026-07-20',
  startTime: '09:00',
  endTime: '12:00',
  doctorName: 'Dr Sharma',
  doctorCode: 'D001',
  speciality: 'Orthopedics',
  campAddress: '12 MG Road',
  pincode: '560001',
  state: 'Karnataka',
  district: 'Bengaluru Urban',
  city: 'Bengaluru',
  hq: 'Bengaluru',
  zone: 'South Zone',
  expectedPatients: 50,
  contactPersonLevel: 'Territory Manager',
  fieldPersonName: 'Ravi Kumar',
  fieldPersonPhone: '9876543210',
};

const cases = [
  {
    name: 'sample template headers match Create Camp form order',
    run: () => {
      const labels = getCampImportFields().map((field) => field.label);
      assert(labels.length === EXPECTED_HEADERS.length, `expected ${EXPECTED_HEADERS.length} headers, got ${labels.length}`);
      EXPECTED_HEADERS.forEach((label, index) => {
        assert(labels[index] === label, `header ${index + 1} expected "${label}", got "${labels[index]}"`);
      });
    },
  },
  {
    name: 'source labels normalize to canonical values',
    run: () => {
      assert(normalizeImportSource('Import') === 'excel', 'Import → excel');
      assert(normalizeImportSource('WhatsApp') === 'whatsapp', 'WhatsApp → whatsapp');
      assert(normalizeImportSource('dashboard') === 'dashboard', 'dashboard stays');
      assert(normalizeImportSource('') === 'excel', 'blank defaults to excel');
    },
  },
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
    name: 'paste partial with doctor and date only',
    rows: [{
      source: 'paste',
      clientName: 'Acme Pharma',
      campaignType: 'Cardio',
      campaignName: 'BMD',
      doctorName: 'Dr Sharma',
      doctorCode: 'D001',
      campDate: '2026-07-22',
    }],
    options: { source: 'paste', allowPartial: true },
    expectValid: 0,
    expectPartial: 1,
    expectInvalid: 0,
  },
  {
    name: 'paste without anchor fields stays invalid',
    rows: [{
      source: 'paste',
      clientName: 'Acme Pharma',
      campaignType: 'Cardio',
      campaignName: 'BMD',
    }],
    options: { source: 'paste', allowPartial: true },
    expectValid: 0,
    expectPartial: 0,
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
  {
    name: 'new template headers map to internal keys',
    run: () => {
      const result = matchImportColumns(EXPECTED_HEADERS);
      assert(result.mapping.source === 'Source of Request', 'source maps');
      assert(result.mapping.requestDate === 'Request Date', 'requestDate maps');
      assert(result.mapping.speciality === 'Doctor Type / Specialty', 'speciality maps');
      assert(result.mapping.campAddress === 'Camp / Clinic Address', 'campAddress maps');
      assert(result.mapping.contactPersonLevel === 'Contact Person Level', 'contactPersonLevel maps');
      assert(!result.missingRequiredFields.length, `unexpected missing: ${result.missingRequiredFields.join(', ')}`);
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
      const { validRows, partialRows, invalidRows } = validateMappedImportRows(
        testCase.rows,
        testCase.options || { source: 'excel' },
      );
      assert(validRows.length === testCase.expectValid, `expected ${testCase.expectValid} valid, got ${validRows.length}`);
      if (testCase.expectPartial != null) {
        assert(partialRows.length === testCase.expectPartial, `expected ${testCase.expectPartial} partial, got ${partialRows.length}`);
      }
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
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${testCase.name}: ${err.message}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
