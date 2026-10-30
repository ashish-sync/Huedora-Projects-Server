import test from 'node:test';
import assert from 'node:assert/strict';
import { matchImportColumns } from './import/importColumnMatcher.js';
import {
  missingProgramFormImportColumns,
  PROGRAM_FORM_IMPORT_KEYS,
  PROGRAM_FORM_SAMPLE_FIELDS,
  PROGRAM_REQUEST_FORM_SOURCE,
  publicProgramRequestContext,
  sanitizeProgramRequestBody,
} from './campRequestForm.service.js';

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
  assert.equal(ctx.requestFormTokenHash, undefined);
  assert.equal(ctx.billingGstin, undefined);
});

test('sample template headers map onto the public camp request form fields', () => {
  const headers = PROGRAM_FORM_SAMPLE_FIELDS.map((field) => field.label);
  const matched = matchImportColumns(headers, PROGRAM_FORM_IMPORT_KEYS);
  assert.deepEqual(missingProgramFormImportColumns(matched.mapping), []);
  assert.equal(matched.mapping.doctorName, 'Doctor Name');
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
    hq: 'HQ (Headquarter)',
    expectedPatients: 'Expected Patients',
    tmName: 'TM Name',
    tmPhone: 'TM Number',
  });
  assert.deepEqual(missing, []);
});
