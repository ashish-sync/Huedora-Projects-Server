import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExecutionDocumentBaseName,
  buildExecutionDocumentFileName,
  buildStubExecutionDocuments,
  doctorNameFileToken,
  executionDocTypeCode,
  executionDocumentDisplayName,
  stripLegacyCampDateFromExecutionName,
} from './executionDocumentName.js';

test('doctorNameFileToken strips Dr prefix and uppercases', () => {
  assert.equal(doctorNameFileToken('Dr Karan'), 'KARAN');
  assert.equal(doctorNameFileToken('Dr. Karan Sharma'), 'KARANSHARMA');
  assert.equal(doctorNameFileToken('Karan'), 'KARAN');
  assert.equal(doctorNameFileToken('Adi'), 'ADI');
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
      docType: 'doctor_form',
    }),
    'KARANDF',
  );
  assert.equal(
    buildExecutionDocumentBaseName({
      doctorName: 'Adi',
      docType: 'patient_form',
    }),
    'ADIPF',
  );
  assert.equal(
    buildExecutionDocumentBaseName({
      doctorName: 'Dr Karan',
      docType: 'gps_selfie',
    }),
    'KARANGS',
  );
});

test('buildExecutionDocumentFileName keeps extension and avoids collisions', () => {
  assert.deepEqual(
    buildExecutionDocumentFileName({
      doctorName: 'Karan',
      docType: 'doctor_form',
      originalName: 'scan.pdf',
    }),
    { fileName: 'KARANDF.pdf', storedName: 'KARANDF.pdf' },
  );
  assert.deepEqual(
    buildExecutionDocumentFileName({
      doctorName: 'Karan',
      docType: 'doctor_form',
      originalName: 'scan.pdf',
      existingNames: ['KARANDF.pdf'],
    }),
    { fileName: 'KARANDF-2.pdf', storedName: 'KARANDF-2.pdf' },
  );
  assert.deepEqual(
    buildExecutionDocumentFileName({
      doctorName: 'Adi',
      docType: 'patient_form',
      originalName: 'scan.webp',
      campScope: '26-10-0001',
    }),
    { fileName: 'ADIPF.webp', storedName: '26-10-0001__ADIPF.webp' },
  );
});

test('stripLegacyCampDateFromExecutionName removes DDMMYYYY after doc code', () => {
  assert.equal(stripLegacyCampDateFromExecutionName('ADIPF10102026.webp'), 'ADIPF.webp');
  assert.equal(
    stripLegacyCampDateFromExecutionName('26-10-0001__ADIPF10102026.webp'),
    '26-10-0001__ADIPF.webp',
  );
  assert.equal(stripLegacyCampDateFromExecutionName('ADIPF.webp'), 'ADIPF.webp');
});

test('executionDocumentDisplayName prefers clean logical name', () => {
  assert.equal(
    executionDocumentDisplayName({
      fileName: 'ADIPF10102026.webp',
      storedName: '26-10-0001__ADIPF10102026.webp',
    }),
    'ADIPF.webp',
  );
  assert.equal(
    executionDocumentDisplayName({
      storedName: '26-10-0001__KARANDF.webp',
    }),
    'KARANDF.webp',
  );
});

test('buildStubExecutionDocuments uses canonical nomenclature', () => {
  const docs = buildStubExecutionDocuments(
    { doctorName: 'Adi', campId: '26-10-0001' },
    { ext: '.pdf' },
  );
  assert.equal(docs.length, 2);
  assert.equal(docs[0].fileName, 'ADIDF.pdf');
  assert.equal(docs[0].storedName, '26-10-0001__ADIDF.pdf');
  assert.equal(docs[0].docType, 'doctor_form');
  assert.equal(docs[1].fileName, 'ADIPF.pdf');
  assert.equal(docs[1].storedName, '26-10-0001__ADIPF.pdf');
});
