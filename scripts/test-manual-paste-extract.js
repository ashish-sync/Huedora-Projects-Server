import assert from 'node:assert/strict';
import {
  extractManualPasteFields,
  formatManualPasteOutput,
  NOT_PROVIDED,
} from '../src/modules/campOps/manualPaste.extract.js';

const SAMPLE = `
Date: 15/08/2026
Camp Type: Screening
Doctor Name: Dr. Rajesh Kumar
Doctor Code: DOC123
Camp Address: 12 MG Road, Pune, Maharashtra 411001
Expected Patients: 45
Technician Name: Ignore Me
Technician Mobile: 9999999999
Client: Some Client
SE Name: Amit Sharma
SE Mobile: 9876543210
ABM Name: Should Not Pick
ABM Mobile: 1111111111
Start Time: 10:00 AM
End Time: 02:30 PM
`.trim();

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error.message);
    process.exitCode = 1;
  }
}

test('extracts labeled fields and contact priority (SE first)', () => {
  const { display, row } = extractManualPasteFields(SAMPLE);

  assert.equal(display.doctorName, 'Dr. Rajesh Kumar');
  assert.equal(row.doctorCode, 'DOC123');
  assert.equal(display.campAddress, '12 MG Road, Pune, Maharashtra 411001');
  assert.equal(display.state, 'Maharashtra');
  assert.equal(display.city, 'Pune');
  assert.equal(display.hq, 'Pune');
  assert.equal(display.pincode, '411001');
  assert.equal(display.expectedPatients, '45');
  assert.equal(row.expectedPatients, 45);
  assert.equal(display.fieldPersonName, 'Amit Sharma');
  assert.equal(display.fieldPersonPhone, '9876543210');
});

test('uses first and second time mentions for camp schedule', () => {
  const { display } = extractManualPasteFields(SAMPLE);
  assert.equal(display.startTime, '10:00');
  assert.equal(display.endTime, '14:30');
});

test('falls back to alternate doctor and code labels', () => {
  const text = `
Date: 01-01-2026
Doctor: Anita Patel
SC Code: SC99
Camp Venue: Main Hall, Jaipur, Rajasthan 302001
Expected Patients: 10
BO Name: Ravi
BO Contact No: 9000000001
Time: 09:00
Time: 11:00
`.trim();
  const { display } = extractManualPasteFields(text);
  assert.equal(display.doctorName, 'Anita Patel');
  assert.equal(display.doctorCode, 'SC99');
  assert.equal(display.fieldPersonName, 'Ravi');
  assert.equal(display.fieldPersonPhone, '9000000001');
});

test('returns Not Provided for missing fields', () => {
  const { display } = extractManualPasteFields('Doctor: Test');
  assert.equal(display.campDate, NOT_PROVIDED);
  assert.equal(display.startTime, NOT_PROVIDED);
  assert.equal(display.endTime, NOT_PROVIDED);
  assert.equal(display.doctorCode, NOT_PROVIDED);
});

test('formatManualPasteOutput matches required labels', () => {
  const { display } = extractManualPasteFields(SAMPLE);
  const output = formatManualPasteOutput(display);
  assert.match(output, /^Camp Date:\n/);
  assert.match(output, /Contact Person Number:\n9876543210$/);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log('\nAll manual paste extract tests passed.');
