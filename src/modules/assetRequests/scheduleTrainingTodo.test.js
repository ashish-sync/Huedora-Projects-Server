import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTrainingTodoPayload,
  createTrainingTodoForScheduler,
  schedulerIdFromRow,
} from './scheduleTrainingTodo.js';

describe('buildTrainingTodoPayload', () => {
  it('builds title, body, startAt and endAt (+1h) from schedule', () => {
    const payload = buildTrainingTodoPayload(
      {
        requestNumber: 'TR-001',
        trainingTopic: 'ECG Basics',
        traineeName: 'Dr Mehta',
        trainingMode: 'Physical',
      },
      {
        scheduledAt: '2026-12-01T10:00:00.000Z',
        scheduleVenue: 'Room A',
      }
    );
    assert.ok(payload);
    assert.equal(payload.kind, 'task');
    assert.equal(payload.title, 'Training · TR-001 · ECG Basics');
    assert.equal(payload.startAt, '2026-12-01T10:00:00.000Z');
    assert.equal(payload.endAt, '2026-12-01T11:00:00.000Z');
    assert.match(payload.body, /Request: TR-001/);
    assert.match(payload.body, /Topic: ECG Basics/);
    assert.match(payload.body, /Trainee: Dr Mehta/);
    assert.match(payload.body, /Venue \/ trainer: Room A/);
    assert.match(payload.body, /Mode: Physical/);
  });

  it('returns null without a valid scheduledAt', () => {
    assert.equal(buildTrainingTodoPayload({ requestNumber: 'TR-1' }, {}), null);
    assert.equal(
      buildTrainingTodoPayload({}, { scheduledAt: 'not-a-date', scheduleVenue: 'X' }),
      null
    );
  });

  it('truncates long titles to 160 chars', () => {
    const topic = 'T'.repeat(200);
    const payload = buildTrainingTodoPayload(
      { requestNumber: 'TR-9', trainingTopic: topic },
      { scheduledAt: '2026-12-01T10:00:00.000Z' }
    );
    assert.ok(payload.title.length <= 160);
  });
});

describe('schedulerIdFromRow', () => {
  it('prefers FULFILLED status actor', () => {
    assert.equal(
      schedulerIdFromRow({
        requestorId: 'r1',
        approverId: 'a1',
        hiringUpdates: [
          { kind: 'STATUS', progress: 'IN_PROGRESS', actorId: 'x' },
          { kind: 'STATUS', progress: 'FULFILLED', actorId: 'scheduler-9' },
        ],
      }),
      'scheduler-9'
    );
  });
});

describe('createTrainingTodoForScheduler', () => {
  it('calls createEvent and returns event id', async () => {
    const calls = [];
    const id = await createTrainingTodoForScheduler({
      row: { requestNumber: 'TR-002', trainingTopic: 'Pulse ox' },
      schedule: {
        scheduledAt: '2026-12-02T09:00:00.000Z',
        scheduleVenue: 'Lab',
      },
      ownerId: 'user-1',
      actor: { _id: 'user-1' },
      createEvent: async (ownerId, payload, actor) => {
        calls.push({ ownerId, payload, actor });
        return { id: 'cal-99' };
      },
    });
    assert.equal(id, 'cal-99');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].ownerId, 'user-1');
    assert.equal(calls[0].payload.startAt, '2026-12-02T09:00:00.000Z');
  });

  it('swallows createEvent errors and returns empty id', async () => {
    const logs = [];
    const id = await createTrainingTodoForScheduler({
      row: { _id: 'req-1', requestNumber: 'TR-003' },
      schedule: { scheduledAt: '2026-12-03T09:00:00.000Z', scheduleVenue: 'Hall' },
      ownerId: 'user-1',
      createEvent: async () => {
        throw new Error('calendar down');
      },
      log: { error: (...args) => logs.push(args) },
    });
    assert.equal(id, '');
    assert.equal(logs.length, 1);
  });
});
