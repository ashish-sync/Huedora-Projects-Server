import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSpaces, toProperTitleCase, formatTextValue, formatDoctorName, formatContactPersonName, getDoctorNameFormatError } from './textFormat.js';

test('cleanSpaces trims and collapses whitespace', () => {
  assert.equal(cleanSpaces('  hello   world  '), 'hello world');
  assert.equal(cleanSpaces('a\n\tb'), 'a b');
});

test('toProperTitleCase applies headline rules', () => {
  assert.equal(toProperTitleCase('demo pharma ltd'), 'Demo Pharma Ltd');
  assert.equal(toProperTitleCase('doctor of cardiology'), 'Doctor of Cardiology');
  assert.equal(toProperTitleCase('  ravi   kumar  '), 'Ravi Kumar');
});

test('formatTextValue respects field kinds', () => {
  assert.equal(formatTextValue('  SN-1001  ', 'serialNumber'), 'SN-1001');
  assert.equal(formatTextValue('  user@example.com  ', 'email'), 'user@example.com');
  assert.equal(formatTextValue('  9876543210  ', 'contact'), '9876543210');
  assert.equal(formatTextValue('  mumbai  ', 'city'), 'Mumbai');
  assert.equal(formatTextValue('  guru krupa clinic, virar west  ', 'campAddress'), 'Guru Krupa Clinic, Virar West');
  assert.equal(formatTextValue('  mahesh  ', 'hcwName'), 'Mahesh');
  assert.equal(formatTextValue('  not initiated  ', 'agreementStatus'), 'not initiated');
  assert.equal(formatTextValue('  request  ', 'lifecycleStage'), 'request');
  assert.equal(formatTextValue('  pending_review  ', 'status'), 'pending_review');
  assert.equal(formatTextValue('  payment_confirmed  ', 'paymentSubmitStatus'), 'payment_confirmed');
  assert.equal(formatTextValue('  dr.  ravi   kumar  ', 'doctorName'), 'Ravi Kumar');
  assert.equal(formatTextValue('  amit   sharma  ', 'fieldPersonName'), 'Amit Sharma');
});

test('formatDoctorName strips prefix and applies title case', () => {
  assert.equal(formatDoctorName('  dr. rajesh   kumar  '), 'Rajesh Kumar');
  assert.equal(formatDoctorName('Doctor Anita Desai'), 'Anita Desai');
});

test('formatContactPersonName applies title case', () => {
  assert.equal(formatContactPersonName('  ravi   kumar  '), 'Ravi Kumar');
});

test('getDoctorNameFormatError rejects Dr prefix', () => {
  assert.equal(
    getDoctorNameFormatError('Dr. Rajesh Kumar'),
    'Enter doctor name without Dr or Dr. — use Title Case (e.g. Rajesh Kumar)',
  );
  assert.equal(getDoctorNameFormatError('Rajesh Kumar'), null);
});
