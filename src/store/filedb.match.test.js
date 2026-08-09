import test from 'node:test';
import assert from 'node:assert/strict';
import {
  idsEqual,
  normalizeDocumentEntityIds,
  normalizeEntityId,
} from '../utils/entityIds.js';
import { matchDocument } from './filedb.js';
import { resolveMappedConsumablesFromRecords } from '../modules/campOps/clientMasterConsumables.js';

test('normalizeEntityId lowercases hex ObjectIds', () => {
  assert.equal(normalizeEntityId('F6342befd31999712840be5e'), 'f6342befd31999712840be5e');
  assert.equal(normalizeEntityId('CLIENT-CODE'), 'CLIENT-CODE');
});

test('normalizeDocumentEntityIds lowercases clientId/_id only', () => {
  const doc = normalizeDocumentEntityIds({
    _id: 'AAAAAAAAAAAAAAAAaaaaaaaa',
    clientId: 'BBBBBBBBBBBBBBBBbbbbbbbb',
    clientName: 'Acme',
    code: 'AbC',
  });
  assert.equal(doc._id, 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(doc.clientId, 'bbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(doc.code, 'AbC');
});

test('hex ObjectId equality is case-insensitive', () => {
  const doc = { clientId: 'f6342befd31999712840be5e', isDeleted: false };
  assert.equal(
    matchDocument(doc, { clientId: 'F6342befd31999712840be5e', isDeleted: false }),
    true
  );
  assert.equal(idsEqual('F6342befd31999712840be5e', 'f6342befd31999712840be5e'), true);
});

test('non-hex ids remain case-sensitive', () => {
  const doc = { code: 'AbC' };
  assert.equal(matchDocument(doc, { code: 'abc' }), false);
  assert.equal(matchDocument(doc, { code: 'AbC' }), true);
});

test('$in matches hex ids case-insensitively', () => {
  const doc = { clientId: 'aaaaaaaaaaaaaaaaaaaaaaaa' };
  assert.equal(
    matchDocument(doc, { clientId: { $in: ['AAAAAAAAAAAAAAAAaaaaaaaa'] } }),
    true
  );
});

test('consumables resolve with loose division/method matching', () => {
  const mapped = resolveMappedConsumablesFromRecords([
    {
      programName: 'Ortho Care',
      campName: 'bmd',
      mappedConsumables: [{ productId: 'p1', itemName: 'Kit' }],
      isActive: true,
    },
  ], {
    campaignType: 'ortho care',
    campaignName: 'BMD',
  });
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].productId, 'p1');
});
