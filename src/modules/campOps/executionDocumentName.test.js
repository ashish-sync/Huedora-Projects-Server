import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExecutionDocumentBaseName,
  buildExecutionDocumentFileName,
  campDateFileToken,
  doctorNameFileToken,
  executionDocTypeCode,
} from './executionDocumentName.js';

test('doctorNameFileToken strips Dr prefix and uppercases', () => {
  assert.equal(doctorNameFileToken('Dr Karan'), 'KARAN');
  assert.equal(doctorNameFileToken('Dr. Karan Sharma'), 'KARANSHARMA');
  assert.equal(doctorNameFileToken('Karan'), 'KARAN');
});

test('campDateFileToken formats DDMMYYYY', () => {
  assert.equal(campDateFileToken('2026-08-03'), '03082026');
  assert.equal(campDateFileToken('03/08/2026'), '03082026');
});

test('executionDocTypeCode maps DF PF GS', () => {
  assert.equal(executionDocTypeCode('doctor_form'), 'DF');
  assert.equal(executionDocTypeCode('patient_form'), 'PF');
  assert.equal(executionDocTypeCode('gps_selfie'), 'GS');
  assert.equal(executionDocTypeCode('other'), 'OT');
});

test('buildExecutionDocumentBaseName matches KARANDF03082026 pattern', () => {
  assert.equal(
    buildExecutionDocumentBaseName({
      doctorName: 'Dr Karan',
      campDate: '2026-08-03',
      docType: 'doctor_form',
    }),
    'KARANDF03082026',
  );
  assert.equal(
    buildExecutionDocumentBaseName({
      doctorName: 'Dr Karan',
      campDate: '2026-08-03',
      docType: 'patient_form',
    }),
    'KARANPF03082026',
  );
  assert.equal(
    buildExecutionDocumentBaseName({
      doctorName: 'Dr Karan',
      campDate: '2026-08-03',
      docType: 'gps_selfie',
    }),
    'KARANGS03082026',
  );
});

test('buildExecutionDocumentFileName keeps extension and avoids collisions', () => {
  assert.deepEqual(
    buildExecutionDocumentFileName({
      doctorName: 'Karan',
      campDate: '2026-08-03',
      docType: 'doctor_form',
      originalName: 'scan.pdf',
    }),
    { fileName: 'KARANDF03082026.pdf', storedName: 'KARANDF03082026.pdf' },
  );
  assert.deepEqual(
    buildExecutionDocumentFileName({
      doctorName: 'Karan',
      campDate: '2026-08-03',
      docType: 'doctor_form',
      originalName: 'scan.pdf',
      existingNames: ['KARANDF03082026.pdf'],
    }),
    { fileName: 'KARANDF03082026-2.pdf', storedName: 'KARANDF03082026-2.pdf' },
  );
  assert.deepEqual(
    buildExecutionDocumentFileName({
      doctorName: 'Karan',
      campDate: '2026-08-03',
      docType: 'doctor_form',
      originalName: 'scan.pdf',
      campScope: 'CAMP-1',
    }),
    { fileName: 'KARANDF03082026.pdf', storedName: 'CAMP-1__KARANDF03082026.pdf' },
  );
});
