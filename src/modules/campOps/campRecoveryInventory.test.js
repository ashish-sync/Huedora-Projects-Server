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
  buildCampRecoveryInventory,
  recoveryInventoryToCsv,
} from './campRecoveryInventory.js';

let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camp-recovery-inv-'));
  configurePersistence({ backend: 'file', dataDirectory: tempDir });
  await hydratePersistence();
});

test.after(async () => {
  clearPersistenceCache();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

function fatSnapshot(overrides = {}) {
  const base = {
    _id: 'hist-1',
    campId: '28-10-0008',
    clientName: 'Acme',
    doctorName: 'Dr Test',
    campDate: '2028-10-08',
    status: 'approved',
    lifecycleStage: 'request',
    campaignType: 'Screening',
    campaignName: 'BMD',
    startTime: '09:00',
    endTime: '12:00',
    city: 'Mumbai',
    state: 'Maharashtra',
    createdAt: '2028-10-01T00:00:00.000Z',
    updatedAt: '2028-10-02T00:00:00.000Z',
  };
  // Pad to exceed FULL_SNAPSHOT_KEY_THRESHOLD
  for (let i = 0; i < 90; i += 1) base[`field_${i}`] = `v${i}`;
  return { ...base, ...overrides };
}

test('inventory classifies live, soft-deleted, and rehydrate candidates', async () => {
  clearPersistenceCache();
  await saveCollection(
    'camp_ops_camps',
    [
      {
        _id: 'live-1',
        campId: '28-10-0001',
        isDeleted: false,
        clientName: 'Live Co',
        campDate: '2028-10-01',
        status: 'approved',
      },
      {
        _id: 'del-1',
        campId: '28-10-0002',
        isDeleted: true,
        deletedAt: '2028-10-03T00:00:00.000Z',
        deletionReason: 'test',
        clientName: 'Deleted Co',
        campDate: '2028-10-02',
        status: 'cancelled',
      },
    ],
    { allowDestructiveSync: true }
  );
  const snap = fatSnapshot();
  await saveCollection(
    'audit_logs',
    [
      {
        _id: 'aud-1',
        action: 'camp_ops.approve',
        entityType: 'camp_ops_camp',
        entityId: snap._id,
        after: snap,
        at: '2028-10-02T00:00:00.000Z',
      },
    ],
    { allowDestructiveSync: true }
  );
  await saveCollection('notifications', [], { allowDestructiveSync: true });
  await saveCollection('stored_files', [], { allowDestructiveSync: true });
  await saveCollection('counters', [], { allowDestructiveSync: true });

  const inv = await buildCampRecoveryInventory();
  assert.equal(inv.summary.liveCount, 1);
  assert.equal(inv.summary.softDeletedCount, 1);
  assert.ok(inv.softDeleted[0].feasibility === 'soft_delete_undelete');
  const rehydrate = inv.missing.filter((m) => m.feasibility === 'rehydrate_free_id');
  assert.ok(rehydrate.some((m) => m.campId === '28-10-0008'));

  const csv = recoveryInventoryToCsv(inv);
  assert.ok(csv.includes('soft_deleted'));
  assert.ok(csv.includes('28-10-0002'));
});
