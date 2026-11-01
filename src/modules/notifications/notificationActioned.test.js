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
import { Notification } from './notification.model.js';
import { markMatchingNotificationsActioned } from './notificationActioned.js';

let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-actioned-'));
  configurePersistence({ backend: 'file', dataDirectory: tempDir });
  await hydratePersistence();
});

test.after(async () => {
  clearPersistenceCache();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test('marks matching inbox rows as decided without hiding them', async () => {
  clearPersistenceCache();
  await saveCollection('notifications', [], { allowDestructiveSync: true });
  const row = await Notification.create({
    userId: 'rm-1',
    type: 'CAMP_HCW_GAP_APPROVAL',
    title: 'Camp 26-10-1779 needs approval — HCW gap under 30 minutes',
    entityType: 'camp_ops_camp',
    entityId: 'camp-1779',
    kind: 'approval',
    meta: { kind: 'approval' },
  });

  const marked = await markMatchingNotificationsActioned({
    type: 'CAMP_HCW_GAP_APPROVAL',
    entityId: 'camp-1779',
    decision: 'approve',
    actorId: 'rm-1',
  });
  assert.equal(marked, 1);

  const updated = await Notification.findOne({ _id: row._id });
  assert.equal(updated.meta.decision, 'approve');
  assert.ok(updated.readAt);
  assert.equal(updated.cancelledAt, null);
});
