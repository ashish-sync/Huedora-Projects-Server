/**
 * Mongo replica-set transaction verification for runAtomic.
 * Uses mongodb-memory-server-replset when available; otherwise marks skip with clear reason.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import {
  configurePersistence,
  upsertDocument,
  loadCollection,
  getPersistenceMode,
} from './persistence.js';
import { runAtomic } from './runAtomic.js';

let replset;
let client;
let db;

test('setup mongo replica set for transactions', async (t) => {
  try {
    replset = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const uri = replset.getUri();
    client = new MongoClient(uri);
    await client.connect();
    db = client.db('tylo_atomic_test');
    // Attach .client so runAtomic can startSession (native driver)
    db.client = client;
    configurePersistence({ backend: 'mongo', db });
    assert.equal(getPersistenceMode(), 'mongo');
  } catch (err) {
    t.skip(`Mongo memory replset unavailable: ${err.message}`);
  }
});

test('runAtomic mongo transaction commits movement+asset together', async (t) => {
  if (!db) return t.skip('no mongo replset');
  await upsertDocument('assets', { _id: 'asset-m1', openMovementId: null, status: 'Available' });
  await upsertDocument('movements', { _id: 'mov-m1', status: 'APPROVED', assets: [{ assetId: 'asset-m1' }] });

  await runAtomic(async () => ({
    upserts: [
      { collection: 'assets', docs: [{ _id: 'asset-m1', openMovementId: 'mov-m1', status: 'Available' }] },
      { collection: 'movements', docs: [{ _id: 'mov-m1', status: 'IN_TRANSIT', assets: [{ assetId: 'asset-m1' }] }] },
    ],
    result: true,
  }));

  const assets = await loadCollection('assets');
  const movements = await loadCollection('movements');
  assert.equal(assets.find((a) => a._id === 'asset-m1').openMovementId, 'mov-m1');
  assert.equal(movements.find((m) => m._id === 'mov-m1').status, 'IN_TRANSIT');
});

test('runAtomic mongo transaction rolls back on failure', async (t) => {
  if (!db) return t.skip('no mongo replset');
  await upsertDocument('assets', { _id: 'asset-m2', openMovementId: null, status: 'Available' });
  await upsertDocument('movements', { _id: 'mov-m2', status: 'APPROVED' });

  await assert.rejects(async () => {
    await runAtomic(async () => ({
      upserts: [
        { collection: 'assets', docs: [{ _id: 'asset-m2', openMovementId: 'mov-m2' }] },
        {
          collection: 'movements',
          docs: [
            {
              get _id() {
                throw new Error('forced mongo txn failure');
              },
            },
          ],
        },
      ],
    }));
  });

  // After abort, either rolled back by Mongo txn or fallback serialize — asset must not stay half-applied
  // under true transaction. Re-read from Mongo directly.
  const fromDb = await db.collection('tylo_assets').findOne({ _id: 'asset-m2' });
  // With transactions: should be null openMovementId. With fallback serialize+partial: may differ.
  // Prefer asserting transaction path: openMovementId null when replset supports txn.
  assert.ok(fromDb);
  assert.equal(fromDb.openMovementId, null);
});

test('concurrent runAtomic calls serialize without lost updates', async (t) => {
  if (!db) return t.skip('no mongo replset');
  await upsertDocument('assets', { _id: 'asset-c1', qty: 0 });

  await Promise.all(
    [1, 2, 3, 4, 5].map((n) =>
      runAtomic(async () => {
        const rows = await loadCollection('assets');
        const row = rows.find((a) => a._id === 'asset-c1');
        const next = { ...row, qty: (Number(row.qty) || 0) + 1, bump: n };
        return {
          upserts: [{ collection: 'assets', docs: [next] }],
          result: next.qty,
        };
      })
    )
  );

  const fromDb = await db.collection('tylo_assets').findOne({ _id: 'asset-c1' });
  assert.equal(Number(fromDb.qty), 5);
});

test('teardown mongo replset', async () => {
  try {
    await client?.close();
  } catch {
    /* ignore */
  }
  try {
    await replset?.stop();
  } catch {
    /* ignore */
  }
});
