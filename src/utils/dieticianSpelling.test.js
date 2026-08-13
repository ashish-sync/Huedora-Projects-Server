import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeDieticianLabel,
  canonicalizeDieticianText,
  CANONICAL_DIETICIAN,
} from './dieticianSpelling.js';

test('canonicalizeDieticianLabel maps all aliases to Dietician', () => {
  assert.equal(canonicalizeDieticianLabel('Dietitian'), CANONICAL_DIETICIAN);
  assert.equal(canonicalizeDieticianLabel('dietitian'), CANONICAL_DIETICIAN);
  assert.equal(canonicalizeDieticianLabel('Dietician'), CANONICAL_DIETICIAN);
  assert.equal(canonicalizeDieticianLabel('deitician'), CANONICAL_DIETICIAN);
  assert.equal(canonicalizeDieticianLabel('Technician'), 'Technician');
});

test('canonicalizeDieticianText rewrites embedded Dietitian spelling', () => {
  assert.equal(canonicalizeDieticianText('Dietitian Kit'), 'Dietician Kit');
  assert.equal(canonicalizeDieticianText('Use dietitians carefully'), 'Use dieticians carefully');
});
