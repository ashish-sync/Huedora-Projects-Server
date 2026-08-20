import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { configurePersistence } from '../../store/persistence.js';
import { Notification } from './notification.model.js';
import {
  markNotificationDelivery,
  retryFailedNotificationDeliveries,
} from './notificationDelivery.js';

test('notification delivery retries success and failure without duplicates', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-notif-'));
  configurePersistence({ backend: 'file', dataDirectory: dir });

  const row = await Notification.create({
    userId: 'u1',
    type: 'TEST',
    title: 'Hello',
    emailStatus: 'failed',
    deliveryAttempts: 0,
    isDeleted: false,
  });

  let calls = 0;
  const first = await retryFailedNotificationDeliveries({
    maxAttempts: 3,
    send: async () => {
      calls += 1;
      throw new Error('provider down');
    },
  });
  assert.equal(first.failed, 1);
  assert.equal(calls, 1);
  const afterFail = await Notification.findOne({ _id: row._id });
  assert.equal(afterFail.emailStatus, 'failed');
  assert.equal(Number(afterFail.deliveryAttempts), 1);

  const second = await retryFailedNotificationDeliveries({
    maxAttempts: 3,
    send: async () => {
      calls += 1;
    },
  });
  assert.equal(second.succeeded, 1);
  assert.equal(calls, 2);
  const afterOk = await Notification.findOne({ _id: row._id });
  assert.equal(afterOk.emailStatus, 'sent');
  assert.ok(afterOk.deliveredAt);

  // Already sent — not retried
  const third = await retryFailedNotificationDeliveries({
    maxAttempts: 3,
    send: async () => {
      calls += 1;
    },
  });
  assert.equal(third.attempted, 0);
  assert.equal(calls, 2);

  await markNotificationDelivery(row._id, { status: 'sent' });
});
