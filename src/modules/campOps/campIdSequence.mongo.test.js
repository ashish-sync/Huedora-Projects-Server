/**
 * Mongo-mode Camp ID allocator + uniq_campId index verification.
 * Uses mongodb-memory-server; skips cleanly when unavailable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import {
  configurePersistence,
  clearPersistenceCache,
  getPersistenceMode,
  saveCollection,
} from '../../store/persistence.js';
import {
  allocateCampId,
  CAMP_ID_COUNTER_PREFIX,
  findDuplicateCampIdGroups,
} from './campIdSequence.js';

let memoryServer;
let client;
let db;
let mongoReady = false;

test('setup mongo memory server for campId sequence', async (t) => {
  try {
    memoryServer = await MongoMemoryServer.create();
    const uri = memoryServer.getUri();
    client = new MongoClient(uri);
    await client.connect();
    db = client.db('tylo_camp_id_test');
    configurePersistence({ backend: 'mongo', db });
    clearPersistenceCache();
    assert.equal(getPersistenceMode(), 'mongo');
    await saveCollection('camp_ops_camps', [], { allowDestructiveSync: true });
    await saveCollection('counters', [], { allowDestructiveSync: true });
    mongoReady = true;
  } catch (err) {
    t.skip(`Mongo memory server unavailable: ${err.message}`);
  }
});

test('mongo allocateCampId is unique under concurrency', async (t) => {
  if (!mongoReady) return t.skip('no mongo');
  await saveCollection('camp_ops_camps', [], { allowDestructiveSync: true });
  await saveCollection('counters', [], { allowDestructiveSync: true });
  const date = new Date(2028, 0, 15);
  const ids = await Promise.all(Array.from({ length: 50 }, () => allocateCampId(date)));
  assert.equal(new Set(ids).size, 50);
  const counter = await db.collection('tylo_counters').findOne({
    _id: `${CAMP_ID_COUNTER_PREFIX}202801`,
  });
  assert.equal(Number(counter.seq), 50);
  assert.equal(counter.neverReuse, true);
});

test('mongo soft-deleted campId stays reserved via counter floor', async (t) => {
  if (!mongoReady) return t.skip('no mongo');
  await saveCollection(
    'camp_ops_camps',
    [
      {
        _id: 'mongo-del-1',
        campId: '28-02-0003',
        isDeleted: true,
        campDate: '2028-02-01',
        createdAt: '2028-02-01T00:00:00.000Z',
      },
    ],
    { allowDestructiveSync: true }
  );
  await saveCollection('counters', [], { allowDestructiveSync: true });
  const next = await allocateCampId(new Date(2028, 1, 10));
  assert.equal(next, '28-02-0004');
});

test('mongo uniq_campId index rejects duplicates after clean data', async (t) => {
  if (!mongoReady) return t.skip('no mongo');
  await saveCollection(
    'camp_ops_camps',
    [
      {
        _id: 'uniq-a',
        campId: '28-03-0001',
        isDeleted: false,
        createdAt: '2028-03-01T00:00:00.000Z',
      },
    ],
    { allowDestructiveSync: true }
  );
  assert.equal((await findDuplicateCampIdGroups()).length, 0);
  const col = db.collection('tylo_camp_ops_camps');
  await col.createIndex({ campId: 1 }, { unique: true, name: 'uniq_campId' });
  await assert.rejects(
    () =>
      col.insertOne({
        _id: 'uniq-b',
        campId: '28-03-0001',
        isDeleted: false,
      }),
    (err) => err && err.code === 11000
  );
});

test('teardown mongo memory server for campId sequence', async () => {
  try {
    await client?.close();
  } catch {
    /* ignore */
  }
  try {
    await memoryServer?.stop();
  } catch {
    /* ignore */
  }
});
