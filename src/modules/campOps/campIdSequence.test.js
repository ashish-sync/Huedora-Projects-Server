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
  loadCollection,
  upsertDocument,
} from '../../store/persistence.js';
import {
  allocateCampId,
  campIdPeriod,
  formatCampId,
  parseCampId,
  findDuplicateCampIdGroups,
  initializeAllCampIdCounters,
  campIdExists,
  maxCampIdSeqForPrefix,
  inventoryCampIds,
  dedupeDuplicateCampIds,
  CAMP_ID_COUNTER_PREFIX,
} from './campIdSequence.js';
import { archiveCampRecord, generateCampId } from './campOps.helpers.js';
import { CampOpsCamp } from './campOps.model.js';

let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camp-id-seq-'));
  configurePersistence({ backend: 'file', dataDirectory: tempDir });
  await hydratePersistence();
});

test.after(async () => {
  clearPersistenceCache();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function resetStores(camps = []) {
  clearPersistenceCache();
  await saveCollection('camp_ops_camps', camps, { allowDestructiveSync: true });
  await saveCollection('counters', [], { allowDestructiveSync: true });
}

test('parse and format Camp ID', () => {
  assert.deepEqual(parseCampId('26-11-0016'), {
    yy: '26',
    mm: '11',
    sequence: 16,
    prefix: '26-11-',
  });
  assert.equal(formatCampId('26', '11', 3), '26-11-0003');
  assert.equal(campIdPeriod(new Date(2026, 10, 15)).yyyymm, '202611');
  assert.equal(campIdPeriod(new Date(2026, 10, 15)).counterId, `${CAMP_ID_COUNTER_PREFIX}202611`);
});

test('allocateCampId starts at 0001 and increments', async () => {
  await resetStores([]);
  const a = await allocateCampId(new Date(2027, 0, 5));
  const b = await allocateCampId(new Date(2027, 0, 6));
  assert.equal(a, '27-01-0001');
  assert.equal(b, '27-01-0002');
});

test('allocateCampId floors from existing camps including soft-deleted', async () => {
  await resetStores([
    {
      _id: 'c1',
      campId: '27-02-0005',
      isDeleted: true,
      deletedAt: '2027-02-01T00:00:00.000Z',
      createdAt: '2027-02-01T00:00:00.000Z',
    },
    {
      _id: 'c2',
      campId: '27-02-0003',
      isDeleted: false,
      createdAt: '2027-02-01T00:00:00.000Z',
    },
  ]);
  const next = await allocateCampId(new Date(2027, 1, 10));
  assert.equal(next, '27-02-0006');
});

test('soft-delete does not release ID for reuse', async () => {
  await resetStores([]);
  const first = await allocateCampId(new Date(2027, 2, 1));
  assert.equal(first, '27-03-0001');
  await upsertDocument('camp_ops_camps', {
    _id: 'del-1',
    campId: first,
    isDeleted: false,
    campDate: '2027-03-01',
    createdAt: '2027-03-01T00:00:00.000Z',
  });
  const camp = await CampOpsCamp.findOne({ _id: 'del-1' });
  archiveCampRecord(camp, { actorId: 'admin' });
  await camp.save();
  assert.equal(camp.isDeleted, true);
  const second = await allocateCampId(new Date(2027, 2, 2));
  assert.equal(second, '27-03-0002');
  assert.notEqual(second, first);
});

test('failed insert after allocate burns the sequence', async () => {
  await resetStores([]);
  const burned = await allocateCampId(new Date(2027, 3, 1));
  assert.equal(burned, '27-04-0001');
  // Insert never happens — next allocate must skip burned id
  const next = await allocateCampId(new Date(2027, 3, 1));
  assert.equal(next, '27-04-0002');
});

test('month transition uses independent counters', async () => {
  await resetStores([]);
  const nov = await allocateCampId(new Date(2027, 10, 30));
  const dec = await allocateCampId(new Date(2027, 11, 1));
  assert.equal(nov, '27-11-0001');
  assert.equal(dec, '27-12-0001');
});

test('100 concurrent allocations are unique', async () => {
  await resetStores([]);
  const date = new Date(2027, 4, 15);
  const ids = await Promise.all(Array.from({ length: 100 }, () => allocateCampId(date)));
  const unique = new Set(ids);
  assert.equal(unique.size, 100);
  assert.ok([...unique].every((id) => id.startsWith('27-05-')));
  const counters = await loadCollection('counters');
  const row = counters.find((c) => c._id === `${CAMP_ID_COUNTER_PREFIX}202705`);
  assert.equal(Number(row.seq), 100);
});

test('findDuplicateCampIdGroups and initializeAllCampIdCounters', async () => {
  await resetStores([
    {
      _id: 'a',
      campId: '27-06-0002',
      createdAt: '2027-06-01T00:00:00.000Z',
      isDeleted: false,
    },
    {
      _id: 'b',
      campId: '27-06-0002',
      createdAt: '2027-06-02T00:00:00.000Z',
      isDeleted: false,
    },
    {
      _id: 'c',
      campId: '27-06-0007',
      createdAt: '2027-06-03T00:00:00.000Z',
      isDeleted: true,
    },
  ]);
  const dups = await findDuplicateCampIdGroups();
  assert.equal(dups.length, 1);
  assert.equal(dups[0].campId, '27-06-0002');
  assert.equal(dups[0].rows[0]._id, 'a');

  const inits = await initializeAllCampIdCounters();
  const june = inits.find((i) => i.counterId === `${CAMP_ID_COUNTER_PREFIX}202706`);
  assert.ok(june);
  assert.equal(june.seq, 7);
  assert.equal(await maxCampIdSeqForPrefix('27-06-'), 7);
  assert.equal(await campIdExists('27-06-0007'), true);
  assert.equal(await campIdExists('27-06-9999'), false);
});

test('generateCampId delegates to allocator', async () => {
  await resetStores([]);
  const id = await generateCampId(new Date(2027, 7, 1));
  assert.equal(id, '27-08-0001');
});

test('inventory reports holes and duplicates; dedupe dry-run does not write', async () => {
  await resetStores([
    {
      _id: 'keep',
      campId: '27-09-0001',
      createdAt: '2027-09-01T00:00:00.000Z',
      isDeleted: false,
      campDate: '2027-09-01',
    },
    {
      _id: 'collide',
      campId: '27-09-0001',
      createdAt: '2027-09-02T00:00:00.000Z',
      isDeleted: false,
      campDate: '2027-09-02',
    },
    {
      _id: 'gap',
      campId: '27-09-0003',
      createdAt: '2027-09-03T00:00:00.000Z',
      isDeleted: false,
      campDate: '2027-09-03',
    },
  ]);
  const inv = await inventoryCampIds();
  assert.equal(inv.indexReady, false);
  assert.equal(inv.duplicates.length, 1);
  const sep = inv.months.find((m) => m.yyyymm === '202709');
  assert.ok(sep);
  assert.deepEqual(sep.holes, [2]);

  const dry = await dedupeDuplicateCampIds({ dryRun: true, apply: false });
  assert.equal(dry.applied, false);
  assert.equal(dry.changes.length, 1);
  const after = await loadCollection('camp_ops_camps');
  assert.equal(after.filter((r) => r.campId === '27-09-0001').length, 2);
});

test('gated dedupe apply renumbers newer colliding row only', async () => {
  await resetStores([
    {
      _id: 'keep2',
      campId: '27-10-0004',
      createdAt: '2027-10-01T00:00:00.000Z',
      isDeleted: false,
      campDate: '2027-10-01',
    },
    {
      _id: 'newer',
      campId: '27-10-0004',
      createdAt: '2027-10-02T00:00:00.000Z',
      isDeleted: false,
      campDate: '2027-10-02',
    },
  ]);
  const prev = process.env.TYLO_CAMP_ID_DEDUP;
  process.env.TYLO_CAMP_ID_DEDUP = '1';
  try {
    const result = await dedupeDuplicateCampIds({ dryRun: false, apply: true });
    assert.equal(result.applied, true);
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0].from, '27-10-0004');
    assert.match(result.changes[0].to, /^27-10-\d{4}$/);
    assert.notEqual(result.changes[0].to, '27-10-0004');
    const rows = await loadCollection('camp_ops_camps');
    const keep = rows.find((r) => r._id === 'keep2');
    const newer = rows.find((r) => r._id === 'newer');
    assert.equal(keep.campId, '27-10-0004');
    assert.equal(newer.campId, result.changes[0].to);
    assert.equal((await findDuplicateCampIdGroups()).length, 0);
  } finally {
    if (prev == null) delete process.env.TYLO_CAMP_ID_DEDUP;
    else process.env.TYLO_CAMP_ID_DEDUP = prev;
  }
});
