import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSerialNumber,
  requireNormalizedSerialNumber,
} from './serialNumber.js';

test('normalizeSerialNumber trims, removes spaces, and uppercases', () => {
  assert.equal(normalizeSerialNumber(' 1626 013605 '), '1626013605');
  assert.equal(normalizeSerialNumber('  sn-abc  '), 'SN-ABC');
  assert.equal(normalizeSerialNumber(''), '');
  assert.equal(normalizeSerialNumber(null), '');
});

test('requireNormalizedSerialNumber rejects blank serials', () => {
  assert.equal(requireNormalizedSerialNumber(' ab12 '), 'AB12');
  assert.throws(() => requireNormalizedSerialNumber('   '), /Serial Number is required/);
});
