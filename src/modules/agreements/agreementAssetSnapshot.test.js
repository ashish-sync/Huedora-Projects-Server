import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  configurePersistence,
  clearPersistenceCache,
  hydratePersistence,
  saveCollection,
} from '../../store/persistence.js';
import { AgreementAsset } from '../agreements/agreement.model.js';
import '../assets/asset.model.js';
import { captureAgreementAssetSnapshot } from '../agreements/agreementAssetSnapshot.js';

let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agr-snap-'));
  configurePersistence({ backend: 'file', dataDirectory: tempDir });
  await hydratePersistence();
});

test.after(() => {
  clearPersistenceCache();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test('linking an asset freezes identity fields and later captures do not overwrite', async () => {
  clearPersistenceCache();
  await saveCollection('assets', [{
    _id: 'asset-live',
    deviceNameSnapshot: 'Original Monitor',
    productType: 'Medical Device',
    assetType: 'Tylo Owned',
    serialNumber: 'SN-LOCK-1',
    assetTag: 'AST-LOCK',
    isDeleted: false,
  }], { allowDestructiveSync: true });
  await saveCollection('agreement_assets', [], { allowDestructiveSync: true });
  await saveCollection('logistics_products', [], { allowDestructiveSync: true });

  const link = await AgreementAsset.create({
    agreementId: 'agr-1',
    assetId: 'asset-live',
    isActive: true,
  });

  await captureAgreementAssetSnapshot(link, null, { source: 'link' });
  assert.equal(link.assetSnapshot.assetName, 'Original Monitor');
  assert.equal(link.assetSnapshot.serialNumber, 'SN-LOCK-1');
  assert.equal(link.assetSnapshot.ownershipType, 'Tylo Owned');
  assert.equal(link.assetSnapshot.productType, 'Medical Device');

  await saveCollection('assets', [{
    _id: 'asset-live',
    deviceNameSnapshot: 'Renamed Monitor',
    productType: 'Non-Medical Device',
    assetType: 'Client Owned',
    serialNumber: 'SN-CHANGED',
    assetTag: 'AST-LOCK',
    isDeleted: false,
  }], { allowDestructiveSync: true });

  await captureAgreementAssetSnapshot(link, null, { source: 'sign' });
  assert.equal(link.assetSnapshot.assetName, 'Original Monitor');
  assert.equal(link.assetSnapshot.serialNumber, 'SN-LOCK-1');
  assert.equal(link.assetSnapshot.capturedSource, 'link');
});
