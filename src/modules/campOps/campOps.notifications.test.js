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
import { notifyEvent } from '../notifications/notifyEvent.js';
import { Notification } from '../notifications/notification.model.js';
import { resolveEventMeta, NOTIFICATION_PRIORITIES } from '../notifications/notificationCatalog.js';
import { notifyCampBulkSummary, notifyCampWorkflow } from './campOps.notifications.js';

let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camp-notif-'));
  configurePersistence({ backend: 'file', dataDirectory: tempDir });
  await hydratePersistence();
});

test.after(async () => {
  clearPersistenceCache();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function resetNotifications() {
  clearPersistenceCache();
  await saveCollection('notifications', [], { allowDestructiveSync: true });
  await saveCollection('users', [], { allowDestructiveSync: true });
  await saveCollection('roles', [], { allowDestructiveSync: true });
}

test('catalog maps camp bulk events to camp module priorities', () => {
  assert.equal(resolveEventMeta('CAMP_BULK_PARTIAL').priority, NOTIFICATION_PRIORITIES.CRITICAL);
  assert.equal(resolveEventMeta('CAMP_BULK_SUCCESS').module, 'camp');
  assert.equal(resolveEventMeta('CAMP_APPROVED').priority, NOTIFICATION_PRIORITIES.IMPORTANT);
});

test('notifyEvent sorts newest first when listed by createdAt desc', async () => {
  await resetNotifications();
  const userId = 'user-notif-1';
  await notifyEvent({
    type: 'CAMP_REVIEW',
    title: 'Older',
    recipients: [userId],
    includeWatchers: false,
    group: false,
  });
  await new Promise((r) => setTimeout(r, 5));
  await notifyEvent({
    type: 'CAMP_REVIEW',
    title: 'Newer',
    recipients: [userId],
    includeWatchers: false,
    group: false,
  });
  const rows = await Notification.find({ userId }).sort({ createdAt: -1 });
  assert.equal(rows[0].title, 'Newer');
  assert.equal(rows[1].title, 'Older');
});

test('notifyEvent groups duplicate unread events for the same entity', async () => {
  await resetNotifications();
  const userId = 'user-group-1';
  const first = await notifyEvent({
    type: 'ENTITY_WATCH_UPDATE',
    title: 'Watched camp updated',
    entityType: 'camp_ops_camp',
    entityId: 'camp-1',
    recipients: [userId],
    includeWatchers: false,
    group: true,
  });
  const second = await notifyEvent({
    type: 'ENTITY_WATCH_UPDATE',
    title: 'Watched camp updated',
    entityType: 'camp_ops_camp',
    entityId: 'camp-1',
    recipients: [userId],
    includeWatchers: false,
    group: true,
  });
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(String(first[0]._id), String(second[0]._id));
  assert.equal(second[0].groupCount, 2);
  const all = await Notification.find({ userId });
  assert.equal(all.length, 1);
});

test('notifyCampWorkflow ignores routine lifecycle actions', async () => {
  await resetNotifications();
  await notifyCampWorkflow({
    camp: { _id: 'c1', campId: '26-08-0001', createdById: 'u1' },
    action: 'assignment_save',
    actorId: 'actor-1',
  });
  const rows = await Notification.find({});
  assert.equal(rows.length, 0);
});

test('notifyCampBulkSummary creates one summary for the actor', async () => {
  await resetNotifications();
  const actorId = 'bulk-actor';
  const created = await notifyCampBulkSummary({
    action: 'import',
    actorId,
    success: Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, campId: `C${i}` })),
    skipped: [{ reason: 'duplicate' }, { reason: 'missing client' }],
    failed: [{ reason: 'invalid date' }],
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].userId, actorId);
  assert.match(created[0].title, /100 succeeded/);
  assert.match(created[0].title, /2 skipped/);
  assert.match(created[0].title, /1 failed/);
  assert.equal(created[0].type, 'CAMP_BULK_PARTIAL');
  assert.equal(created[0].meta.successCount, 100);
  assert.equal(created[0].meta.skippedCount, 2);
  assert.equal(created[0].meta.failedCount, 1);

  const all = await Notification.find({ userId: actorId });
  assert.equal(all.length, 1);
});

test('notifyCampBulkSummary is a no-op without actor or rows', async () => {
  await resetNotifications();
  assert.deepEqual(await notifyCampBulkSummary({ action: 'approve', actorId: 'x' }), []);
  assert.deepEqual(
    await notifyCampBulkSummary({
      action: 'approve',
      success: [{ id: '1' }],
    }),
    [],
  );
});
