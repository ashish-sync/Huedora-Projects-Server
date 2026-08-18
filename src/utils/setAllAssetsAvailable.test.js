import test from 'node:test';
import assert from 'node:assert/strict';
import { Asset } from '../modules/assets/asset.model.js';
import { setAllAssetsAvailable } from './setAllAssetsAvailable.js';

test('setAllAssetsAvailable moves every active non-available asset to Available', async () => {
  const suffix = Date.now();
  const purchased = await Asset.create({
    assetTag: `AST-PUR-${suffix}`,
    serialNumber: `SET-ALL-PUR-${suffix}`,
    deviceNameSnapshot: 'Purchased Asset',
    status: 'Purchased',
  });
  const assigned = await Asset.create({
    assetTag: `AST-ASN-${suffix}`,
    serialNumber: `SET-ALL-ASN-${suffix}`,
    deviceNameSnapshot: 'Assigned Asset',
    status: 'Assigned',
  });
  const available = await Asset.create({
    assetTag: `AST-AVL-${suffix}`,
    serialNumber: `SET-ALL-AVL-${suffix}`,
    deviceNameSnapshot: 'Available Asset',
    status: 'Available',
  });

  try {
    const result = await setAllAssetsAvailable({ actorId: 'test', dryRun: false });
    assert.ok(result.assetsUpdated >= 2);

    const refreshedPurchased = await Asset.findOne({ _id: purchased._id });
    const refreshedAssigned = await Asset.findOne({ _id: assigned._id });
    const refreshedAvailable = await Asset.findOne({ _id: available._id });

    assert.equal(refreshedPurchased.status, 'Available');
    assert.equal(refreshedAssigned.status, 'Available');
    assert.equal(refreshedAvailable.status, 'Available');
  } finally {
    for (const row of [purchased, assigned, available]) {
      row.isDeleted = true;
      row.deletedAt = new Date().toISOString();
      await row.save();
    }
  }
});

test('setAllAssetsAvailable dry-run reports changes without mutating rows', async () => {
  const suffix = Date.now() + 1;
  const purchased = await Asset.create({
    assetTag: `AST-DRY-${suffix}`,
    serialNumber: `SET-ALL-DRY-${suffix}`,
    deviceNameSnapshot: 'Dry Run Asset',
    status: 'Purchased',
  });

  try {
    const result = await setAllAssetsAvailable({ actorId: 'test', dryRun: true });
    assert.ok(result.assetsUpdated >= 1);
    assert.equal(result.targetStatus, 'Available');

    const refreshed = await Asset.findOne({ _id: purchased._id });
    assert.equal(refreshed.status, 'Purchased');
  } finally {
    purchased.isDeleted = true;
    purchased.deletedAt = new Date().toISOString();
    await purchased.save();
  }
});
