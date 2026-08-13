import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeAssetsBySerialNumber } from './dedupeAssetsBySerial.js';
import { Asset } from '../modules/assets/asset.model.js';
import { normalizeSerialNumber } from '../modules/assets/serialNumber.js';

test('dedupeAssetsBySerialNumber soft-deletes extras and keeps one normalized row', async () => {
  const suffix = Date.now();
  const serial = `SN${suffix}`;
  const kept = await Asset.create({
    assetTag: `AST-KEEP-${suffix}`,
    serialNumber: ` ${serial.toLowerCase()} `,
    deviceNameSnapshot: 'Keeper',
    status: 'Purchased',
    deviceValue: 100,
  });
  const dupe = await Asset.create({
    assetTag: `AST-DUPE-${suffix}`,
    serialNumber: serial,
    deviceNameSnapshot: 'Dupe',
    status: 'Purchased',
  });

  try {
    const result = await dedupeAssetsBySerialNumber({
      actorId: 'test',
      dryRun: false,
    });
    assert.ok(result.assetsPurged >= 1);

    const refreshedKeeper = await Asset.findOne({ _id: kept._id });
    const refreshedDupe = await Asset.findOne({ _id: dupe._id });
    assert.equal(normalizeSerialNumber(refreshedKeeper.serialNumber), serial);
    assert.equal(refreshedKeeper.isDeleted, false);
    assert.equal(refreshedDupe.isDeleted, true);
  } finally {
    for (const row of [kept, dupe]) {
      row.isDeleted = true;
      row.deletedAt = new Date().toISOString();
      await row.save();
    }
  }
});
