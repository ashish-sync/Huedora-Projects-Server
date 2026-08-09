import assert from 'node:assert/strict';
import { PASTE_FIXTURE_LABELED } from '../src/modules/campOps/eventExtractor/fixtures.js';
import {
  extractManualPasteFields,
  formatManualPasteOutput,
  NOT_PROVIDED,
} from '../src/modules/campOps/manualPaste.extract.js';
import { applyPasteDefaults } from '../src/modules/campOps/manualPaste.service.js';

const SAMPLE = PASTE_FIXTURE_LABELED;

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

  assert.equal(display.doctorName, 'Rajesh Kumar');
  assert.equal(row.doctorName, 'Rajesh Kumar');
  assert.equal(row.doctorCode, 'DOC123');
  assert.equal(display.campAddress, '12 MG Road, Pune, Maharashtra 411001');
  assert.equal(display.state, 'Maharashtra');
  assert.equal(display.city, 'Pune');
  assert.equal(display.hq, 'Pune');
  assert.equal(display.pincode, '411001');
  assert.equal(display.zone, 'West Zone');
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

test('derives zone from state and prefers labeled PIN', () => {
  const text = `
Date: 01-01-2026
Doctor: Anita Patel
Camp Venue: Main Hall, Jaipur, Rajasthan
PIN Code: 302001
Expected Patients: 10
`.trim();
  const { display } = extractManualPasteFields(text);
  assert.equal(display.pincode, '302001');
  assert.equal(display.state, 'Rajasthan');
  assert.equal(display.zone, 'North Zone');
});

test('formatManualPasteOutput includes camp date and contact', () => {
  const { display } = extractManualPasteFields(SAMPLE);
  const output = formatManualPasteOutput(display);
  assert.match(output, /^Source of Request:\n/);
  assert.match(output, /Camp Date:\n2026-08-15\n/);
  assert.match(output, /City:\nPune\n/);
  assert.match(output, /Contact Person Number:\n9876543210/);
});

test('manual paste uses selected method instead of defaulting to Others', () => {
  const row = applyPasteDefaults(
    { doctorName: 'Dr Test' },
    { clientName: 'Demo Pharma Ltd', campaignType: 'Demo Screening Program', campaignName: 'BMD' },
  );
  assert.equal(row.campaignName, 'BMD');
});

test('extracts bulleted Coimbatore-style request with In/Out Time', () => {
  const text = `
- Doctor Name: Dr Leo bernard 
- Doctor SC Code: 0000409698
- Employee name: Mohamed Thameem 
- Employee Mobile no : 9043584663
- Camp Venue: Leo Ortho care Hospital 
- 790, Near Nilgiris & Opposite RHR Hotel, Trichy Road, Ramanathapuram, Coimbatore-641045, Tamil Nadu
- Pincode of camp place: 641045
- Date: 15.08.2026
- In Time: 08.30 am
- Out Time: 2.30pm
- Expected Patients: 80
`.trim();
  const { row, display } = extractManualPasteFields(text);
  assert.equal(row.doctorName, 'Leo Bernard');
  assert.equal(row.doctorCode, '0000409698');
  assert.equal(row.campDate, '2026-08-15');
  assert.equal(row.startTime, '08:30');
  assert.equal(row.endTime, '14:30');
  assert.equal(row.pincode, '641045');
  assert.equal(row.expectedPatients, 80);
  assert.equal(row.fieldPersonName, 'Mohamed Thameem');
  assert.equal(row.fieldPersonPhone, '9043584663');
  assert.match(display.campAddress, /Trichy Road|Leo Ortho/i);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log('\nAll manual paste extract tests passed.');
