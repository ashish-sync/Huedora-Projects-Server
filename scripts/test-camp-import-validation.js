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
  'TM Name',
  'TM Number',
  'AM Name',
  'AM Number',
  'RM Name',
  'RM Number',
  'ZM Name',
  'ZM Number',
  'PM Name',
  'PM Number',
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
  tmName: 'Ravi Kumar',
  tmPhone: '9876543210',
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
    name: 'PIN missing from geography master reports Pin Code Missing in Master instead of State or Zone',
    rows: [{
      ...validRow,
      pincode: '999999',
      state: '',
      zone: '',
      pinMasterMissing: true,
    }],
    expectValid: 0,
    expectInvalid: 1,
    expectErrorIncludes: 'Pin Code Missing in Master',
    expectErrorExcludes: ['State is required', 'Zone is required'],
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
      tmName: '',
      tmPhone: '',
      expectedPatients: 0,
    }],
    expectValid: 0,
    expectInvalid: 1,
  },
  {
    name: 'multiple contact levels map into contactPersons',
    rows: [{
      ...validRow,
      tmName: 'Ravi Kumar',
      tmPhone: '9876543210',
      amName: 'Anita AM',
      amPhone: '9123456780',
      zmName: 'Zonal Zee',
      zmPhone: '9988776655',
    }],
    expectValid: 1,
    expectInvalid: 0,
    assertRow: (row) => {
      assert(row.contactPersons?.length === 3, `expected 3 contacts, got ${row.contactPersons?.length}`);
      assert(row.contactPersons[0].level === 'Territory Manager', 'first contact is TM');
      assert(row.contactPersons[1].level === 'Area Manager', 'second contact is AM');
      assert(row.contactPersons[2].level === 'Zonal Manager', 'third contact is ZM');
      assert(row.fieldPersonName === 'Ravi Kumar', 'primary mirrors TM name');
    },
  },
  {
    name: 'legacy single contact columns still work',
    rows: [{
      ...validRow,
      tmName: '',
      tmPhone: '',
      contactPersonLevel: 'Area Manager',
      fieldPersonName: 'Legacy AM',
      fieldPersonPhone: '9000011111',
    }],
    expectValid: 1,
    expectInvalid: 0,
    assertRow: (row) => {
      assert(row.contactPersons?.length === 1, 'one legacy contact');
      assert(row.contactPersons[0].level === 'Area Manager', 'legacy level preserved');
    },
  },
  {
    name: 'missing all contact levels is invalid',
    rows: [{
      ...validRow,
      tmName: '',
      tmPhone: '',
      amName: '',
      amPhone: '',
    }],
    expectValid: 0,
    expectInvalid: 1,
    expectErrorIncludes: 'At least one contact person level is required',
  },
  {
    name: 'paste with only doctor+date is review-required (missing PIN and start)',
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
    expectPartial: 0,
    expectInvalid: 1,
    expectErrorIncludes: 'PIN code',
  },
  {
    name: 'paste with doctor+PIN+date+start is creatable as partial',
    rows: [{
      source: 'paste',
      clientName: 'Acme Pharma',
      campaignType: 'Cardio',
      campaignName: 'BMD',
      doctorName: 'Dr Sharma',
      campDate: '2026-07-22',
      pincode: '411001',
      startTime: '10:00',
    }],
    options: { source: 'paste', allowPartial: true },
    expectValid: 0,
    expectPartial: 1,
    expectInvalid: 0,
  },
  {
    name: 'paste without mandatory fields stays invalid',
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
    name: 'paste missing optional endTime/contacts still creatable',
    rows: [{
      source: 'paste',
      clientName: 'Acme Pharma',
      campaignType: 'Cardio',
      campaignName: 'BMD',
      doctorName: 'Rajesh Kumar',
      campDate: '2026-08-15',
      pincode: '411001',
      startTime: '09:30',
      campAddress: '',
      endTime: '',
      doctorCode: '',
      expectedPatients: '',
      tmName: '',
      tmPhone: '',
      fieldPersonName: '',
      fieldPersonPhone: '',
    }],
    options: { source: 'paste', allowPartial: true },
    expectValid: 0,
    expectPartial: 1,
    expectInvalid: 0,
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
      assert(result.mapping.tmName === 'TM Name', 'tmName maps');
      assert(result.mapping.amPhone === 'AM Number', 'amPhone maps');
      assert(result.mapping.pmName === 'PM Name', 'pmName maps');
      assert(!result.missingRequiredFields.length, `unexpected missing: ${result.missingRequiredFields.join(', ')}`);
    },
  },
  {
    name: 'legacy contact headers still map',
    run: () => {
      const result = matchImportColumns([
        'Contact Person Level',
        'Contact Person Name',
        'Contact Person Number',
      ]);
      assert(result.mapping.contactPersonLevel === 'Contact Person Level', 'legacy level maps');
      assert(result.mapping.fieldPersonName === 'Contact Person Name', 'legacy name maps');
      assert(result.mapping.fieldPersonPhone === 'Contact Person Number', 'legacy number maps');
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
      if (testCase.expectErrorExcludes) {
        const errors = invalidRows[0]?.errors || [];
        for (const needle of testCase.expectErrorExcludes) {
          assert(
            !errors.some((err) => String(err).includes(needle)),
            `did not expect error containing "${needle}", got: ${errors.join('; ')}`,
          );
        }
      }
      if (testCase.assertRow && validRows[0]) {
        testCase.assertRow(validRows[0]);
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
