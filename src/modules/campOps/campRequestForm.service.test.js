import test from 'node:test';
import assert from 'node:assert/strict';
import { matchImportColumns } from './import/importColumnMatcher.js';
import {
  missingProgramFormImportColumns,
  normalizeProgramFormImportRow,
  PROGRAM_FORM_IMPORT_KEYS,
  PROGRAM_FORM_SAMPLE_FIELDS,
  PROGRAM_FORM_SAMPLE_ROWS,
  PROGRAM_REQUEST_FORM_SOURCE,
  publicProgramRequestContext,
  sanitizeProgramRequestBody,
  stableProgramRequestToken,
} from './campRequestForm.service.js';

test('stableProgramRequestToken is deterministic per program version', () => {
  const a = stableProgramRequestToken('master-123', 1);
  const b = stableProgramRequestToken('master-123', 1);
  const c = stableProgramRequestToken('master-123', 2);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 10);
});

test('sanitizeProgramRequestBody locks client and program fields from the master', () => {
  const safe = sanitizeProgramRequestBody({
    clientId: 'spoof-client',
    clientName: 'Spoof Client',
    campaignType: 'Wrong Division',
    campaignName: 'Wrong Method',
    source: 'dashboard',
    lifecycleStage: 'financial',
    campAmount: 9999,
    doctorName: 'Anita Sharma',
    campDate: '2026-11-02',
    startTime: '09:00',
    endTime: '13:00',
  }, {
    client: { _id: 'client-1', name: 'Acme Health' },
    master: { programName: 'Viva BMD', campName: 'BMD' },
  });

  assert.equal(safe.clientId, 'client-1');
  assert.equal(safe.clientName, 'Acme Health');
  assert.equal(safe.campaignType, 'Viva BMD');
  assert.equal(safe.campaignName, 'BMD');
  assert.equal(safe.source, PROGRAM_REQUEST_FORM_SOURCE);
  assert.equal(safe.lifecycleStage, 'request');
  assert.equal(safe.doctorName, 'Anita Sharma');
  assert.equal(safe.campDate, '2026-11-02');
  assert.equal(safe.campAmount, undefined);
});

test('sanitizeProgramRequestBody keeps selected address coordinates', () => {
  const safe = sanitizeProgramRequestBody({
    campAddress: 'Kempegowda International Airport Bengaluru (BLR), KIAL Rd, Devanahalli',
    googlePlaceId: 'ola-platform:abc',
    addressManualEntry: false,
    latitude: '13.05158',
    longitude: '77.61194',
    doctorName: 'Anita Sharma',
    campDate: '2026-11-02',
  }, {
    client: { _id: 'client-1', name: 'Acme Health' },
    master: { programName: 'Viva BMD', campName: 'BMD' },
  });

  assert.equal(safe.campAddress, 'Kempegowda International Airport Bengaluru (BLR), KIAL Rd, Devanahalli');
  assert.equal(safe.googlePlaceId, 'ola-platform:abc');
  assert.equal(safe.addressManualEntry, false);
  assert.equal(safe.latitude, '13.05158');
  assert.equal(safe.longitude, '77.61194');
});

test('publicProgramRequestContext only exposes program identity', () => {
  const ctx = publicProgramRequestContext(
    {
      programName: 'Ortreso',
      campName: 'BMD',
      campDuration: '4:00',
      campType: 'HCW Only',
      requestFormTokenHash: 'secret-hash',
      billingGstin: '27AAAAA0000A1Z5',
    },
    { _id: 'c1', name: 'Acme Health', code: 'ACM' },
  );

  assert.equal(ctx.clientId, 'c1');
  assert.equal(ctx.clientName, 'Acme Health');
  assert.equal(ctx.clientCode, 'ACM');
  assert.equal(ctx.programName, 'Ortreso');
  assert.equal(ctx.campName, 'BMD');
  assert.equal(ctx.campDuration, '4:00');
  assert.equal(ctx.formMasterId, '');
  assert.equal(ctx.form, null);
  assert.equal(ctx.requestFormTokenHash, undefined);
  assert.equal(ctx.billingGstin, undefined);
});

test('sample template headers map onto the public camp request form fields', () => {
  const headers = PROGRAM_FORM_SAMPLE_FIELDS.map((field) => field.label);
  const matched = matchImportColumns(headers, PROGRAM_FORM_IMPORT_KEYS);
  assert.deepEqual(missingProgramFormImportColumns(matched.mapping), []);
  assert.equal(matched.mapping.doctorName, 'Doctor Name');
  assert.equal(matched.mapping.pincode, 'PIN Code');
  assert.equal(matched.mapping.hq, 'HQ (Headquarter)');
  assert.equal(matched.mapping.fieldPersonName, 'Contact Person Name');
  assert.equal(matched.mapping.expectedPatients, 'Expected Patients');
});

test('missingProgramFormImportColumns allows TM Name/Number in place of contact person columns', () => {
  const missing = missingProgramFormImportColumns({
    doctorName: 'Doctor Name',
    doctorCode: 'Doctor Code',
    campDate: 'Camp Date',
    startTime: 'Camp Start Time',
    endTime: 'Camp End Time',
    campAddress: 'Camp / Clinic Address',
    pincode: 'PIN Code',
    hq: 'HQ (Headquarter)',
    expectedPatients: 'Expected Patients',
    tmName: 'TM Name',
    tmPhone: 'TM Number',
  });
  assert.deepEqual(missing, []);
});

test('missingProgramFormImportColumns flags PIN Code when missing from spreadsheet', () => {
  const missing = missingProgramFormImportColumns({
    doctorName: 'Doctor Name',
    doctorCode: 'Doctor Code',
    campDate: 'Camp Date',
    startTime: 'Camp Start Time',
    endTime: 'Camp End Time',
    campAddress: 'Camp / Clinic Address',
    hq: 'HQ (Headquarter)',
    expectedPatients: 'Expected Patients',
    fieldPersonName: 'Contact Person Name',
    fieldPersonPhone: 'Contact Person Number',
  });
  assert.ok(missing.includes('PIN Code'));
});

test('PROGRAM_FORM_SAMPLE_ROWS provides multiple valid PIN code options across major Indian regions', () => {
  assert.ok(Array.isArray(PROGRAM_FORM_SAMPLE_ROWS));
  assert.ok(PROGRAM_FORM_SAMPLE_ROWS.length >= 3);

  const pinColIndex = PROGRAM_FORM_SAMPLE_FIELDS.findIndex((f) => f.key === 'pincode');
  assert.ok(pinColIndex >= 0);

  const pinCodes = PROGRAM_FORM_SAMPLE_ROWS.map((row) => row[pinColIndex]);
  // Every sample row must have a valid 6-digit Indian PIN code
  for (const pin of pinCodes) {
    assert.match(String(pin), /^\d{6}$/);
  }
  // Check diverse PIN code options are included (e.g. Mumbai 400001, Pune 411001, Bengaluru 560001)
  assert.ok(pinCodes.includes('400001'));
  assert.ok(pinCodes.includes('411001'));
  assert.ok(pinCodes.includes('560001'));
});

test('normalizeProgramFormImportRow cleans and normalizes PIN code', () => {
  const row1 = normalizeProgramFormImportRow({ pincode: '400 001', expectedPatients: '25' });
  assert.equal(row1.pincode, '400001');

  const row2 = normalizeProgramFormImportRow({ pincode: 560001, expectedPatients: '30' });
  assert.equal(row2.pincode, '560001');
});
