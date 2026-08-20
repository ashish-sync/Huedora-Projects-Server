import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readIdempotencyKey,
  beginIdempotentCreate,
  requireIdempotencyKey,
} from './mutationGuards.js';

test('readIdempotencyKey prefers body then header', () => {
  assert.equal(
    readIdempotencyKey({ body: { uniqueKey: 'a' }, get: () => 'b', headers: {} }),
    'a'
  );
  assert.equal(
    readIdempotencyKey({ body: {}, get: (h) => (h === 'Idempotency-Key' ? 'hdr' : ''), headers: {} }),
    'hdr'
  );
});

test('beginIdempotentCreate replays existing', async () => {
  const replay = await beginIdempotentCreate('k1', async () => ({ _id: '1' }));
  assert.equal(replay.replay, true);
  assert.equal(replay.row._id, '1');
  const fresh = await beginIdempotentCreate('k2', async () => null);
  assert.equal(fresh.replay, false);
  assert.equal(fresh.key, 'k2');
});

test('requireIdempotencyKey can enforce presence', () => {
  assert.throws(
    () => requireIdempotencyKey({ body: {}, get: () => '', headers: {} }, { required: true }),
    (err) => err.status === 400
  );
});
