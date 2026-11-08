import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  configurePersistence,
  clearPersistenceCache,
  hydratePersistence,
} from '../../store/persistence.js';
import { User } from '../users/user.model.js';
import { CalendarEvent } from './calendar.model.js';
import {
  acceptRequest,
  assertActiveUsers,
  createEvent,
  declineRequest,
  listEvents,
  suggestAlternative,
  summaryCounts,
} from './calendar.service.js';

let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-service-test-'));
  configurePersistence({ backend: 'file', dataDirectory: tempDir });
  await hydratePersistence();
});

test.after(async () => {
  clearPersistenceCache();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function seedUser(suffix, overrides = {}) {
  return User.create({
    email: `cal.${suffix}@tylo.test`,
    username: `cal_${suffix}`,
    fullName: `Cal User ${suffix}`,
    designation: 'Operations',
    isActive: true,
    isDeleted: false,
    passwordHash: 'x',
    ...overrides,
  });
}

test('calendar task, block, availability accept/decline/suggest flow', async () => {
  const stamp = Date.now();
  const alice = await seedUser(`a_${stamp}`);
  const bob = await seedUser(`b_${stamp}`);
  const aliceId = String(alice._id);
  const bobId = String(bob._id);
  const startAt = new Date(Date.UTC(2026, 10, 15, 4, 30, 0)).toISOString();
  const endAt = new Date(Date.UTC(2026, 10, 15, 5, 30, 0)).toISOString();

  try {
    const task = await createEvent(
      aliceId,
      {
        kind: 'task',
        title: 'Prep HCW list',
        body: 'Confirm tomorrow camps',
        startAt,
        endAt,
        reminderAt: startAt,
      },
      alice,
    );
    assert.equal(task.kind, 'task');
    assert.equal(task.status, 'open');

    const block = await createEvent(
      aliceId,
      {
        kind: 'block',
        title: 'Focus block',
        startAt,
        endAt,
        peerUserId: bobId,
      },
      alice,
    );
    assert.equal(block.kind, 'block');
    assert.ok(block.participantIds.includes(bobId));

    const request = await createEvent(
      aliceId,
      {
        kind: 'availability_request',
        title: 'Sync call',
        startAt,
        endAt,
        peerUserId: bobId,
      },
      alice,
    );
    assert.equal(request.status, 'pending');
    assert.equal(request.canRespond, false);

    const bobMonth = await listEvents(bobId, {
      from: new Date(Date.UTC(2026, 10, 1)).toISOString(),
      to: new Date(Date.UTC(2026, 10, 30, 23, 59, 59)).toISOString(),
    });
    assert.ok(bobMonth.some((row) => row.id === block.id));
    assert.ok(bobMonth.some((row) => row.id === request.id && row.canRespond));

    const bobSummary = await summaryCounts(bobId);
    assert.ok(bobSummary.pendingRequests >= 1);
    assert.ok(bobSummary.badge >= 1);

    const accepted = await acceptRequest(bobId, request.id, { note: 'Works for me' }, bob);
    assert.equal(accepted.status, 'accepted');

    const request2 = await createEvent(
      aliceId,
      {
        kind: 'availability_request',
        title: 'Alt sync',
        startAt,
        endAt,
        peerUserId: bobId,
      },
      alice,
    );
    const declined = await declineRequest(bobId, request2.id, { note: 'Busy' }, bob);
    assert.equal(declined.status, 'declined');

    const request3 = await createEvent(
      aliceId,
      {
        kind: 'availability_request',
        title: 'Suggest sync',
        startAt,
        endAt,
        peerUserId: bobId,
      },
      alice,
    );
    const altStart = new Date(Date.UTC(2026, 10, 16, 6, 0, 0)).toISOString();
    const altEnd = new Date(Date.UTC(2026, 10, 16, 7, 0, 0)).toISOString();
    const suggested = await suggestAlternative(
      bobId,
      request3.id,
      { startAt: altStart, endAt: altEnd, note: 'Tomorrow instead' },
      bob,
    );
    assert.equal(suggested.status, 'suggested');
    assert.equal(suggested.suggestedStartAt, altStart);

    const aliceSummary = await summaryCounts(aliceId);
    assert.ok(aliceSummary.openTasks >= 1);

    const stored = await CalendarEvent.findById(task.id);
    assert.ok(stored);
  } finally {
    try {
      alice.isDeleted = true;
      bob.isDeleted = true;
      await alice.save();
      await bob.save();
    } catch {
      /* ignore */
    }
  }
});

test('assertActiveUsers validates active users and rejects inactive/deleted/non-existent', async () => {
  const stamp = Date.now();
  const activeUser = await seedUser(`act_${stamp}`, { isActive: true, isDeleted: false });
  const inactiveUser = await seedUser(`inact_${stamp}`, { isActive: false, isDeleted: false });
  const deletedUser = await seedUser(`del_${stamp}`, { isActive: true, isDeleted: true });

  const activeId = String(activeUser._id);
  const inactiveId = String(inactiveUser._id);
  const deletedId = String(deletedUser._id);
  const fakeId = '507f1f77bcf86cd799439011';

  // Resolves single active user by string
  const res1 = await assertActiveUsers([activeId]);
  assert.deepEqual(res1, [activeId]);

  // Resolves active user from object with _id or id
  const resObj = await assertActiveUsers([{ _id: activeId }]);
  assert.deepEqual(resObj, [activeId]);

  // Returns empty for empty list
  const resEmpty = await assertActiveUsers([]);
  assert.deepEqual(resEmpty, []);

  // Rejects inactive user
  await assert.rejects(
    async () => assertActiveUsers([inactiveId]),
    (err) => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'NOT_FOUND');
      assert.ok(err.message.includes('not found or are inactive'));
      return true;
    },
  );

  // Rejects soft-deleted user
  await assert.rejects(
    async () => assertActiveUsers([deletedId]),
    (err) => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'NOT_FOUND');
      assert.ok(err.message.includes('not found or are inactive'));
      return true;
    },
  );

  // Rejects non-existent user
  await assert.rejects(
    async () => assertActiveUsers([fakeId]),
    (err) => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'NOT_FOUND');
      assert.ok(err.message.includes('not found or are inactive'));
      return true;
    },
  );

  // Rejects when one valid user is mixed with an invalid/inactive user
  await assert.rejects(
    async () => assertActiveUsers([activeId, inactiveId]),
    (err) => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'NOT_FOUND');
      assert.ok(err.message.includes('not found or are inactive'));
      return true;
    },
  );
});
