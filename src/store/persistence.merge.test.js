import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDocumentFields } from './persistence.js';

test('mergeDocumentFields keeps existing GSTIN when incoming omits it', () => {
  const merged = mergeDocumentFields(
    { _id: '1', name: 'Cipla', gstin: '27AABCU9603R1ZM', pan: 'AABCU9603R' },
    { _id: '1', name: 'Cipla Ltd.', isActive: true }
  );
  assert.equal(merged.gstin, '27AABCU9603R1ZM');
  assert.equal(merged.pan, 'AABCU9603R');
  assert.equal(merged.name, 'Cipla Ltd.');
});

test('mergeDocumentFields allows explicit GSTIN updates', () => {
  const merged = mergeDocumentFields(
    { _id: '1', gstin: 'OLD' },
    { _id: '1', gstin: 'NEWGSTIN1234567' }
  );
  assert.equal(merged.gstin, 'NEWGSTIN1234567');
});
