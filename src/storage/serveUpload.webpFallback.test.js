import test from 'node:test';
import assert from 'node:assert/strict';
import { siblingWebpObjectKey } from './serveUpload.js';

test('siblingWebpObjectKey maps stale image masters to .webp', () => {
  assert.equal(
    siblingWebpObjectKey('contacts/20261010-abcd1234__pan.jpg'),
    'contacts/20261010-abcd1234__pan.webp',
  );
  assert.equal(
    siblingWebpObjectKey('contacts/20261010-abcd1234__bank.PNG'),
    'contacts/20261010-abcd1234__bank.webp',
  );
  assert.equal(siblingWebpObjectKey('contacts/doc.pdf'), '');
  assert.equal(siblingWebpObjectKey('contacts/already.webp'), '');
  assert.equal(siblingWebpObjectKey(''), '');
});
