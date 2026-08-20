import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  configurePersistence,
  upsertDocument,
  loadCollection,
} from './persistence.js';
import { runAtomic } from './runAtomic.js';

test('runAtomic file mode commits multi-collection upserts together', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-atomic-'));
  configurePersistence({ backend: 'file', dataDirectory: dir });

  await upsertDocument('assets', { _id: 'a1', openMovementId: null, status: 'Available' });
  await upsertDocument('movements', { _id: 'm1', status: 'APPROVED', assets: [{ assetId: 'a1' }] });

  await runAtomic(async () => ({
    upserts: [
      { collection: 'assets', docs: [{ _id: 'a1', openMovementId: 'm1', status: 'Available' }] },
      { collection: 'movements', docs: [{ _id: 'm1', status: 'IN_TRANSIT', assets: [{ assetId: 'a1' }] }] },
    ],
    result: true,
  }));

  const assets = await loadCollection('assets');
  const movements = await loadCollection('movements');
  assert.equal(assets.find((a) => a._id === 'a1').openMovementId, 'm1');
  assert.equal(movements.find((m) => m._id === 'm1').status, 'IN_TRANSIT');
});

test('runAtomic file mode rolls back earlier collections when a later write fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-atomic-rb-'));
  configurePersistence({ backend: 'file', dataDirectory: dir });

  await upsertDocument('assets', { _id: 'a2', openMovementId: null, status: 'Available' });
  await upsertDocument('movements', { _id: 'm2', status: 'APPROVED' });

  await assert.rejects(async () => {
    await runAtomic(async () => ({
      upserts: [
        { collection: 'assets', docs: [{ _id: 'a2', openMovementId: 'm2' }] },
        {
          collection: 'movements',
          docs: [
            {
              // Force failure inside apply by omitting _id after prepare returns —
              // simulate by throwing after first group via invalid second group handler.
              get _id() {
                throw new Error('forced failure');
              },
            },
          ],
        },
      ],
    }));
  });

  const assets = await loadCollection('assets');
  assert.equal(assets.find((a) => a._id === 'a2').openMovementId, null);
});
