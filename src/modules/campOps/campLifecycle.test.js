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
import {
  archiveCampRecord,
  restoreCampRecord,
  restoreCampById,
  createRestoreBatch,
  rollbackRestoreBatch,
} from './campLifecycle.js';
import { allocateCampId } from './campIdSequence.js';
import { CampOpsCamp } from './campOps.model.js';

let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camp-lifecycle-'));
  configurePersistence({ backend: 'file', dataDirectory: tempDir });
  await hydratePersistence();
});

test.after(async () => {
  clearPersistenceCache();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function reset(camps = []) {
  clearPersistenceCache();
  await saveCollection('camp_ops_camps', camps, { allowDestructiveSync: true });
  await saveCollection('counters', [], { allowDestructiveSync: true });
  await saveCollection('camp_ops_restore_batches', [], { allowDestructiveSync: true });
}

test('archiveCampRecord stores deletionReason', () => {
  const camp = { _id: '1', campId: '29-01-0001', isDeleted: false };
  archiveCampRecord(camp, { actorId: 'u1', deletionReason: 'Duplicate entry' });
  assert.equal(camp.isDeleted, true);
  assert.equal(camp.deletionReason, 'Duplicate entry');
  assert.equal(camp.deletedBy, 'u1');
});

test('restore preserves campId and is idempotent', async () => {
  await reset([
    {
      _id: 'r1',
      campId: '29-02-0001',
      isDeleted: true,
      deletedAt: '2029-02-01T00:00:00.000Z',
      deletedBy: 'admin',
      deletionReason: 'oops',
      campAmount: 500,
      executionDocuments: [{ id: 'd1', storedName: 'x.pdf' }],
    },
  ]);
  const first = await restoreCampById('r1', { actorId: 'admin', reason: 'Needed again' });
  assert.equal(first.restored, true);
  assert.equal(first.camp.isDeleted, false);
  assert.equal(first.camp.campId, '29-02-0001');
  assert.equal(first.camp.campAmount, 500);
  assert.equal(first.camp.executionDocuments.length, 1);
  assert.equal(first.camp.restoreReason, 'Needed again');

  const second = await restoreCampById('r1', { actorId: 'admin', reason: 'again' });
  assert.equal(second.restored, false);
  assert.equal(second.alreadyLive, true);
  assert.equal(second.camp.campId, '29-02-0001');
});

test('soft-delete does not free ID for allocator', async () => {
  await reset([]);
  const id = await allocateCampId(new Date(2029, 2, 1));
  await CampOpsCamp.create({
    _id: 'alloc-1',
    campId: id,
    isDeleted: false,
    campDate: '2029-03-01',
  });
  const camp = await CampOpsCamp.findOne({ _id: 'alloc-1' });
  archiveCampRecord(camp, { actorId: 'a', deletionReason: 'test' });
  await camp.save();
  const next = await allocateCampId(new Date(2029, 2, 2));
  assert.notEqual(next, id);
});

test('batch restore and rollback', async () => {
  await reset([
    {
      _id: 'b1',
      campId: '29-04-0001',
      isDeleted: true,
      deletedAt: '2029-04-01T00:00:00.000Z',
    },
    {
      _id: 'b2',
      campId: '29-04-0002',
      isDeleted: true,
      deletedAt: '2029-04-01T00:00:00.000Z',
    },
  ]);
  const dry = await createRestoreBatch({
    ids: ['b1', 'b2'],
    reason: 'batch dry',
    dryRun: true,
  });
  assert.equal(dry.dryRun, true);
  assert.equal((await CampOpsCamp.findOne({ _id: 'b1' })).isDeleted, true);

  const applied = await createRestoreBatch({
    ids: ['b1', 'b2'],
    reason: 'batch restore',
    actorId: 'admin',
    dryRun: false,
  });
  assert.equal(applied.restoredIds.length, 2);
  assert.equal((await CampOpsCamp.findOne({ _id: 'b1' })).isDeleted, false);

  const rb = await rollbackRestoreBatch(applied.batchId, { actorId: 'admin' });
  assert.equal(rb.alreadyRolledBack, false);
  assert.equal((await CampOpsCamp.findOne({ _id: 'b1' })).isDeleted, true);
  assert.equal((await CampOpsCamp.findOne({ _id: 'b2' })).isDeleted, true);

  const rb2 = await rollbackRestoreBatch(applied.batchId, { actorId: 'admin' });
  assert.equal(rb2.alreadyRolledBack, true);
});

test('restoreCampRecord helper returns alreadyLive', () => {
  const camp = { _id: 'x', isDeleted: false, campId: '29-05-0001' };
  const result = restoreCampRecord(camp, { actorId: 'a', reason: 'noop' });
  assert.equal(result.alreadyLive, true);
  assert.equal(result.restored, false);
});
