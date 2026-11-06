import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalDateInput } from './campOps.helpers.js';

test('Public Request Form Excel dates stay DD-MM-YY (reported regression cases)', () => {
  // Typed / Indian text cells
  assert.equal(parseLocalDateInput('16-11-26'), '2026-11-16');
  assert.equal(parseLocalDateInput('01-12-26'), '2026-12-01');
  assert.equal(parseLocalDateInput('31-01-27'), '2027-01-31');
  assert.equal(parseLocalDateInput('16-11-2026'), '2026-11-16');
});

test('recovers leftover SheetJS US m/d/yy strings from Excel date cells', () => {
  // Nov 16, 2026 serial formatted as US "11/16/26"
  assert.equal(parseLocalDateInput('11/16/26'), '2026-11-16');
  assert.equal(parseLocalDateInput('1/31/27'), '2027-01-31');
});

test('ambiguous US-formatted Dec 1 still needs dateNF; Indian text is authoritative', () => {
  // After dateNF dd-mm-yyyy, SheetJS emits 01-12-2026
  assert.equal(parseLocalDateInput('01-12-2026'), '2026-12-01');
  assert.equal(parseLocalDateInput('1-12-26'), '2026-12-01');
});

test('keeps ISO and Date instances without UTC day shift', () => {
  assert.equal(parseLocalDateInput('2026-11-16'), '2026-11-16');
  assert.equal(parseLocalDateInput(new Date(2026, 10, 16)), '2026-11-16');
});

test('accepts Excel serial numbers for modern camp dates', () => {
  // 16-Nov-2026 = Excel serial 46342 (1900 date system)
  assert.equal(parseLocalDateInput(46342), '2026-11-16');
  assert.equal(parseLocalDateInput('46342'), '2026-11-16');
  // Do not treat plain years as serials
  assert.equal(parseLocalDateInput('2026'), null);
});
