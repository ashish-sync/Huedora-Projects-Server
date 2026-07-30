import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSpaces, toProperTitleCase, formatTextValue } from './textFormat.js';

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
  assert.equal(formatTextValue('  not initiated  ', 'agreementStatus'), 'not initiated');
});
