import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSET_ONE_DEMO } from './assetOne.seed.js';
import { DOCUMENT_ONE_DEMO } from '../agreements/documentOne.seed.js';

test('Asset One demo constants stay aligned with Document One demo party', () => {
  assert.equal(ASSET_ONE_DEMO.serialNumber, 'DEMO-DOC1-SN-001');
  assert.match(ASSET_ONE_DEMO.name, /Document One/i);
  assert.equal(DOCUMENT_ONE_DEMO.title.includes('Demo Document'), true);
  assert.equal(ASSET_ONE_DEMO.marker.includes('asset-one-document-demo'), true);
});
