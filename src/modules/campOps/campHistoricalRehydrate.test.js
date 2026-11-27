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
} from '../../store/persistence.js';
import {
  rehydrateHistoricalCamps,
  rollbackRehydrateManifest,
} from './campHistoricalRehydrate.js';
import { CampOpsCamp } from './campOps.model.js';
import { CAMP_ID_COUNTER_PREFIX } from './campIdSequence.js';

let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camp-rehydrate-'));
  configurePersistence({ backend: 'file', dataDirectory: tempDir });
  await hydratePersistence();
});

test.after(async () => {
  clearPersistenceCache();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

function fatSnapshot(overrides = {}) {
  const base = {
    _id: 'reh-1',
    campId: '28-11-0009',
    clientName: 'Rehydrate Co',
    doctorName: 'Dr Recover',
    campDate: '2028-11-09',
    status: 'approved',
    lifecycleStage: 'request',
    campaignType: 'Screening',
    createdAt: '2028-11-01T00:00:00.000Z',
    updatedAt: '2028-11-02T00:00:00.000Z',
  };
  for (let i = 0; i < 90; i += 1) base[`field_${i}`] = `v${i}`;
  return { ...base, ...overrides };
}

async function seedAuditOnly() {
  clearPersistenceCache();
  await saveCollection('camp_ops_camps', [], { allowDestructiveSync: true });
  await saveCollection('counters', [], { allowDestructiveSync: true });
  await saveCollection('audit_logs', [
    {
      _id: 'aud-reh',
      action: 'camp_ops.approve',
      entityType: 'camp_ops_camp',
      entityId: 'reh-1',
      after: fatSnapshot(),
      at: '2028-11-02T00:00:00.000Z',
    },
  ], { allowDestructiveSync: true });
  await saveCollection('notifications', [], { allowDestructiveSync: true });
  await saveCollection('stored_files', [], { allowDestructiveSync: true });
  await saveCollection('camp_ops_rehydrate_manifests', [], { allowDestructiveSync: true });
}

test('rehydrate dry-run does not write camps', async () => {
  await seedAuditOnly();
  const result = await rehydrateHistoricalCamps({ dryRun: true, apply: false });
  assert.equal(result.applied, false);
  assert.ok(result.changes.some((c) => c.campId === '28-11-0009' && c.dryRun));
  const camps = await loadCollection('camp_ops_camps');
  assert.equal(camps.length, 0);
});

test('rehydrate apply inserts original id and floors counter', async () => {
  await seedAuditOnly();
  const prev = process.env.TYLO_CAMP_REHYDRATE;
  process.env.TYLO_CAMP_REHYDRATE = '1';
  try {
    const result = await rehydrateHistoricalCamps({ dryRun: false, apply: true });
    assert.equal(result.applied, true);
    assert.ok(result.insertedIds.includes('reh-1'));
    const camp = await CampOpsCamp.findOne({ _id: 'reh-1' });
    assert.ok(camp);
    assert.equal(camp.campId, '28-11-0009');
    assert.equal(camp.rehydratedFromAudit, true);
    const counters = await loadCollection('counters');
    const nov = counters.find((c) => c._id === `${CAMP_ID_COUNTER_PREFIX}202811`);
    assert.ok(nov);
    assert.ok(Number(nov.seq) >= 9);

    const rb = await rollbackRehydrateManifest(result.manifestId, { actorId: 'admin' });
    assert.equal(rb.alreadyRolledBack, false);
    const after = await CampOpsCamp.findOne({ _id: 'reh-1' });
    assert.equal(after.isDeleted, true);
  } finally {
    if (prev == null) delete process.env.TYLO_CAMP_REHYDRATE;
    else process.env.TYLO_CAMP_REHYDRATE = prev;
  }
});

test('rehydrate skips occupied campId', async () => {
  clearPersistenceCache();
  await saveCollection(
    'camp_ops_camps',
    [
      {
        _id: 'live-holder',
        campId: '28-11-0009',
        isDeleted: false,
        clientName: 'Holder',
      },
    ],
    { allowDestructiveSync: true }
  );
  await saveCollection(
    'audit_logs',
    [
      {
        _id: 'aud-conflict',
        action: 'camp_ops.camp_delete',
        entityType: 'camp_ops_camp',
        entityId: 'reh-conflict',
        before: fatSnapshot({ _id: 'reh-conflict', campId: '28-11-0009' }),
        at: '2028-11-03T00:00:00.000Z',
      },
    ],
    { allowDestructiveSync: true }
  );
  await saveCollection('notifications', [], { allowDestructiveSync: true });
  await saveCollection('stored_files', [], { allowDestructiveSync: true });
  await saveCollection('counters', [], { allowDestructiveSync: true });

  const prev = process.env.TYLO_CAMP_REHYDRATE;
  process.env.TYLO_CAMP_REHYDRATE = '1';
  try {
    const result = await rehydrateHistoricalCamps({ dryRun: false, apply: true });
    assert.equal(result.insertedIds.length, 0);
    const holder = await CampOpsCamp.findOne({ _id: 'live-holder' });
    assert.equal(holder.campId, '28-11-0009');
  } finally {
    if (prev == null) delete process.env.TYLO_CAMP_REHYDRATE;
    else process.env.TYLO_CAMP_REHYDRATE = prev;
  }
});
