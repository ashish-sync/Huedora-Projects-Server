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
import { isApprovalRequestNotification, isReviewNotification } from './notificationCatalog.js';
import {
  DEMO_NOTIFICATION_SEED_TAG,
  buildDemoNotificationRows,
  ensureDemoNotifications,
} from './notification.seed.js';

let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-seed-'));
  configurePersistence({ backend: 'file', dataDirectory: tempDir });
  await hydratePersistence();
});

test.after(async () => {
  clearPersistenceCache();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function resetStore() {
  clearPersistenceCache();
  await saveCollection('notifications', [], { allowDestructiveSync: true });
  await saveCollection('users', [
    {
      _id: 'user-camp-admin',
      email: 'campadmin@tylo.local',
      fullName: 'Camp One Demo Admin',
      isDeleted: false,
      isActive: true,
    },
  ], { allowDestructiveSync: true });
  await saveCollection('camp_ops_camps', [
    {
      _id: 'camp-req',
      doctorCode: 'DEMO-REQ',
      campId: '26-11-0001',
      isDeleted: false,
    },
  ], { allowDestructiveSync: true });
}

test('local demo rows cover approvals, reviews, and team inform', () => {
  const rows = buildDemoNotificationRows(
    { _id: 'user-camp-admin' },
    { request: { _id: 'camp-req', campId: '26-11-0001', doctorCode: 'DEMO-REQ' } },
  );
  assert.equal(rows.every((row) => row.meta.demoSeed === DEMO_NOTIFICATION_SEED_TAG), true);
  assert.ok(rows.some((row) => isApprovalRequestNotification(row)));
  assert.ok(rows.some((row) => isReviewNotification(row)));
  assert.ok(rows.some((row) => (
    row.kind === 'update'
    && row.meta.involvement === 'inform'
    && row.meta.audienceMode === 'direct_rm'
  )));
  assert.ok(rows.some((row) => row.readAt));
  assert.ok(rows.some((row) => row.entityId === 'camp-req'));
});

test('ensureDemoNotifications is idempotent for a local demo user', async () => {
  await resetStore();
  const first = await ensureDemoNotifications();
  assert.equal(first.skipped, false);
  assert.equal(first.users, 1);
  assert.ok(first.created >= 8);

  const second = await ensureDemoNotifications();
  assert.equal(second.created, 0);
  assert.equal(second.users, 0);

  const stored = await Notification.find({ userId: 'user-camp-admin' });
  assert.equal(stored.length, first.created);
});
