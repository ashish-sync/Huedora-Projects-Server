import assert from 'node:assert/strict';
import { parseCampRequest } from '../src/modules/campOps/parsers/dist/index.js';

const ABBOTT_SAMPLE = `
Nitin Nandakumar Bachate has planned a health clinic with Dr. ASHISH KOMAR BHATTACHARYA.
Clinic date : 05/08/2026
Expected patient count : 40
Address : 12 MG Road, Pune, Maharashtra 411001
Time : 11 AM to 3 PM
SE Name : Amit Sharma
SE Mobile : 9876543210
RSM Name : Should Not Pick
RSM Mobile : 1111111111
Technician Name : Ignore Tech
Technician Mobile : 9999999999
`.trim();

const KEY_VALUE_SAMPLE = `
Date : 15/08/2026
Dr Name : Dr. Rajesh Kumar
Doctor Code : DOC123
Camp Address : 12 MG Road, Pune, Maharashtra 411001
Expected Patients : 45
Start Time : 10:00 AM
End Time : 02:30 PM
SE Name : Amit Sharma
SE Mobile : 9876543210
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

test('Abbott paragraph parser extracts doctor and contact from narrative', () => {
  const result = parseCampRequest({ text: ABBOTT_SAMPLE, clientId: 'abbott' });
  assert.equal(result.success, true);
  assert.equal(result.parser.parser_used, 'Paragraph Parser');
  assert.match(result.parsed_fields.doctor_name, /Ashish Komar Bhattacharya/i);
  assert.match(result.parsed_fields.contact_person_name, /Nitin Nandakumar Bachate/i);
  assert.equal(result.parsed_fields.camp_date, '2026-08-05');
  assert.equal(result.parsed_fields.camp_start_time, '11:00');
  assert.equal(result.parsed_fields.camp_end_time, '15:00');
  assert.equal(result.parsed_fields.expected_patients, '40');
  assert.equal(result.parsed_fields.pincode, '411001');
});

test('contact priority prefers Technician over SE', () => {
  const result = parseCampRequest({ text: ABBOTT_SAMPLE, clientId: 'generic' });
  assert.equal(result.parsed_fields.contact_person_name, 'Ignore Tech');
  assert.equal(result.parsed_fields.contact_person_number, '9999999999');
});

test('key-value parser extracts labeled fields', () => {
  const result = parseCampRequest({ text: KEY_VALUE_SAMPLE, clientId: 'dr-reddys' });
  assert.equal(result.parsed_fields.doctor_name, 'Rajesh Kumar');
  assert.equal(result.parsed_fields.doctor_code, 'DOC123');
  assert.equal(result.parsed_fields.camp_start_time, '10:00');
  assert.equal(result.parsed_fields.camp_end_time, '14:30');
  assert.equal(result.parsed_fields.city, 'Pune');
});

test('captures unmapped labels for future configuration', () => {
  const text = 'Clinic Coordinator : John Doe\nCamp Lead : Jane\nDate : 01/01/2026';
  const result = parseCampRequest({ text, clientId: 'generic' });
  assert.ok(result.parser.unmapped_labels.includes('Clinic Coordinator'));
  assert.ok(result.parser.unmapped_labels.includes('Camp Lead'));
});

test('never fails — returns missing fields as warnings', () => {
  const result = parseCampRequest({ text: 'Random text without structure', clientId: 'generic' });
  assert.equal(result.success, true);
  assert.ok(result.validation.missing_fields.length > 0);
});

test('output contract matches required JSON shape', () => {
  const result = parseCampRequest({ text: KEY_VALUE_SAMPLE, clientId: 'generic' });
  assert.ok('success' in result);
  assert.ok('parsed_fields' in result);
  assert.ok('validation' in result);
  assert.ok('parser' in result);
  assert.ok('camp_date' in result.parsed_fields);
  assert.ok('contact_person_number' in result.parsed_fields);
  assert.ok(['true', 'false', 'unknown'].includes(result.validation.city_pincode_match));
  assert.ok(Array.isArray(result.validation.missing_fields));
  assert.ok(Array.isArray(result.validation.warnings));
  assert.ok(typeof result.validation.confidence === 'number');
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log('\nAll camp request parser tests passed.');
