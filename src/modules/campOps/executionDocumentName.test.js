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
  assert.equal(doctorNameFileToken('Adi'), 'ADI');
});

test('campDateFileToken formats DDMMYYYY (legacy helper; not used in file names)', () => {
  assert.equal(campDateFileToken('2026-08-03'), '03082026');
  assert.equal(campDateFileToken('03/08/2026'), '03082026');
});

test('executionDocTypeCode maps DF PF GS', () => {
  assert.equal(executionDocTypeCode('doctor_form'), 'DF');
  assert.equal(executionDocTypeCode('patient_form'), 'PF');
  assert.equal(executionDocTypeCode('gps_selfie'), 'GS');
  assert.equal(executionDocTypeCode('other'), 'OT');
});

test('buildExecutionDocumentBaseName is Doctor + DocCode without date', () => {
  assert.equal(
    buildExecutionDocumentBaseName({
      doctorName: 'Dr Karan',
      campDate: '2026-08-03',
      docType: 'doctor_form',
    }),
    'KARANDF',
  );
  assert.equal(
    buildExecutionDocumentBaseName({
      doctorName: 'Adi',
      campDate: '2026-10-10',
      docType: 'patient_form',
    }),
    'ADIPF',
  );
  assert.equal(
    buildExecutionDocumentBaseName({
      doctorName: 'Dr Karan',
      campDate: '2026-08-03',
      docType: 'gps_selfie',
    }),
    'KARANGS',
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
    { fileName: 'KARANDF.pdf', storedName: 'KARANDF.pdf' },
  );
  assert.deepEqual(
    buildExecutionDocumentFileName({
      doctorName: 'Karan',
      campDate: '2026-08-03',
      docType: 'doctor_form',
      originalName: 'scan.pdf',
      existingNames: ['KARANDF.pdf'],
    }),
    { fileName: 'KARANDF-2.pdf', storedName: 'KARANDF-2.pdf' },
  );
  assert.deepEqual(
    buildExecutionDocumentFileName({
      doctorName: 'Adi',
      campDate: '2026-10-10',
      docType: 'patient_form',
      originalName: 'scan.webp',
      campScope: '26-10-0001',
    }),
    { fileName: 'ADIPF.webp', storedName: '26-10-0001__ADIPF.webp' },
  );
});
