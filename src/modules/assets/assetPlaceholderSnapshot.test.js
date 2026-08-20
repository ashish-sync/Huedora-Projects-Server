import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAssetPlaceholderSnapshot,
  snapshotHasIdentity,
} from './assetPlaceholderSnapshot.js';

test('buildAssetPlaceholderSnapshot includes product type, name, ownership, and serial', async () => {
  const snapshot = await buildAssetPlaceholderSnapshot({
    _id: 'asset-1',
    deviceNameSnapshot: 'CarePlus — BP Monitor Pro',
    productType: 'Medical Device',
    assetType: 'Tylo Owned',
    serialNumber: 'SN-1001',
    assetTag: 'AST-1',
  }, { source: 'link' });

  assert.equal(snapshot.assetId, 'asset-1');
  assert.equal(snapshot.productType, 'Medical Device');
  assert.equal(snapshot.assetName, 'CarePlus — BP Monitor Pro');
  assert.equal(snapshot.ownershipType, 'Tylo Owned');
  assert.equal(snapshot.serialNumber, 'SN-1001');
  assert.equal(snapshot.capturedSource, 'link');
  assert.ok(snapshot.capturedAt);
});

test('snapshotHasIdentity is true when serial or name is present', () => {
  assert.equal(snapshotHasIdentity({ serialNumber: 'SN-1' }), true);
  assert.equal(snapshotHasIdentity({ assetName: 'BP Monitor' }), true);
  assert.equal(snapshotHasIdentity({}), false);
  assert.equal(snapshotHasIdentity(null), false);
});
