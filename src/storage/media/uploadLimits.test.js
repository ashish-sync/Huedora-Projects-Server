import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertPixelBudget,
  assertUploadByteLimit,
  MAX_INPUT_PIXELS,
  EXEC_DOC_MAX_BYTES,
} from './uploadLimits.js';
import { withImageProcessGate, imageProcessGateStats } from './imageProcessGate.js';

describe('uploadLimits', () => {
  it('rejects oversized files and megapixel images', () => {
    assert.throws(() => assertUploadByteLimit(EXEC_DOC_MAX_BYTES + 1), /too large/i);
    assert.throws(() => assertPixelBudget(8000, 8000), /resolution is too high/i);
    assert.doesNotThrow(() => assertPixelBudget(1280, 960));
    assert.ok(MAX_INPUT_PIXELS >= 12_000_000);
  });
});

describe('imageProcessGate', () => {
  it('runs jobs serially under concurrency 1', async () => {
    const order = [];
    await Promise.all([
      withImageProcessGate('a', async () => {
        order.push('a-start');
        await new Promise((r) => setTimeout(r, 30));
        order.push('a-end');
      }),
      withImageProcessGate('b', async () => {
        order.push('b-start');
        order.push('b-end');
      }),
    ]);
    assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end']);
    assert.equal(imageProcessGateStats().active, 0);
  });
});
