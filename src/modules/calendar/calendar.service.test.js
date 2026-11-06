import test from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../users/user.model.js';
import { CalendarEvent } from './calendar.model.js';
import {
  acceptRequest,
  createEvent,
  declineRequest,
  listEvents,
  suggestAlternative,
  summaryCounts,
} from './calendar.service.js';

async function seedUser(suffix) {
  return User.create({
    email: `cal.${suffix}@tylo.test`,
    username: `cal_${suffix}`,
    fullName: `Cal User ${suffix}`,
    designation: 'Operations',
    isActive: true,
    isDeleted: false,
    passwordHash: 'x',
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
