import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveCampRecord } from './campOps.helpers.js';

test('archiveCampRecord soft-deletes camp with actor and timestamp', () => {
  const camp = {
    _id: 'abc',
    campId: '26-01-0001',
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
  };

  archiveCampRecord(camp, { actorId: 'user-1', deletedAt: '2026-01-01T00:00:00.000Z' });

  assert.equal(camp.isDeleted, true);
  assert.equal(camp.deletedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(camp.deletedBy, 'user-1');
});
