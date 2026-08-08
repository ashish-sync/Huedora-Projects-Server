import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDocumentFields, assignPreservingExisting, isBlankValue } from './persistence.js';

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

test('mergeDocumentFields preserves existing when incoming blank', () => {
  const merged = mergeDocumentFields(
    { _id: '1', gstin: '27AABCU9603R1ZM', address: 'Pune' },
    { _id: '1', gstin: '', address: null, pan: '' }
  );
  assert.equal(merged.gstin, '27AABCU9603R1ZM');
  assert.equal(merged.address, 'Pune');
  // Both sides blank — empty may be written; nothing valuable was erased.
  assert.ok(isBlankValue(merged.pan));
});

test('mergeDocumentFields applies empty array when key is present', () => {
  const merged = mergeDocumentFields(
    { mappedConsumables: [{ productId: '1' }] },
    { mappedConsumables: [] }
  );
  assert.deepEqual(merged.mappedConsumables, []);
});

test('mergeDocumentFields clears when clearKeys listed', () => {
  const merged = mergeDocumentFields(
    { _id: '1', gstin: 'OLD', notes: 'keep' },
    { _id: '1', gstin: '' },
    { clearKeys: ['gstin'] }
  );
  assert.equal(merged.gstin, '');
  assert.equal(merged.notes, 'keep');
});

test('assignPreservingExisting mutates target safely', () => {
  const row = { name: 'A', gstin: 'G1', city: 'Pune' };
  assignPreservingExisting(row, { name: 'B', gstin: '', city: 'Mumbai' });
  assert.equal(row.name, 'B');
  assert.equal(row.gstin, 'G1');
  assert.equal(row.city, 'Mumbai');
});

test('isBlankValue treats empty array as blank', () => {
  assert.equal(isBlankValue([]), true);
  assert.equal(isBlankValue([1]), false);
  assert.equal(isBlankValue(0), false);
  assert.equal(isBlankValue(false), false);
});
