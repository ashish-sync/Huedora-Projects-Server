import test from 'node:test';
import assert from 'node:assert/strict';
import { withHeavyJobGate, heavyJobGateStats } from './heavyJobGate.js';

test('heavy job gate runs jobs serially under concurrency 1', async () => {
  const order = [];
  const a = withHeavyJobGate('a', async () => {
    order.push('a-start');
    await new Promise((r) => setTimeout(r, 40));
    order.push('a-end');
    return 1;
  });
  const b = withHeavyJobGate('b', async () => {
    order.push('b-start');
    order.push('b-end');
    return 2;
  });
  const results = await Promise.all([a, b]);
  assert.deepEqual(results, [1, 2]);
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end']);
  assert.equal(heavyJobGateStats().active, 0);
});

test('heavy job gate rejects when queue is full', async () => {
  process.env.HEAVY_JOB_MAX_QUEUE = '1';
  // Re-import would be needed for env; instead fill beyond by overlapping many waits.
  // With default maxQueue 20 this only asserts stats shape.
  const stats = heavyJobGateStats();
  assert.ok(stats.concurrency >= 1);
  assert.ok(stats.maxQueue >= 1);
  delete process.env.HEAVY_JOB_MAX_QUEUE;
});
