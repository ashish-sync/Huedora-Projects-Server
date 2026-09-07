import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertPixelBudget,
  assertUploadByteLimit,
  MAX_INPUT_PIXELS,
  EXEC_DOC_MAX_BYTES,
  EXEC_DOC_MAX_FILES_PER_REQUEST,
  isPassthroughWebpMeta,
} from './uploadLimits.js';
import { withImageProcessGate, imageProcessGateStats } from './imageProcessGate.js';

describe('uploadLimits', () => {
  it('rejects oversized files and megapixel images', () => {
    assert.throws(() => assertUploadByteLimit(EXEC_DOC_MAX_BYTES + 1), /too large/i);
    assert.throws(() => assertPixelBudget(4000, 3000), /resolution is too high/i);
    assert.doesNotThrow(() => assertPixelBudget(1280, 960));
    assert.ok(MAX_INPUT_PIXELS <= 8_000_000);
    assert.equal(EXEC_DOC_MAX_FILES_PER_REQUEST, 1);
  });

  it('treats in-budget WebP as passthrough regardless of >900KB size', () => {
    assert.equal(
      isPassthroughWebpMeta({ format: 'webp', width: 1200, height: 900 }, 2_500_000),
      true,
    );
    assert.equal(
      isPassthroughWebpMeta({ format: 'webp', width: 2000, height: 1500 }, 100_000),
      false,
    );
    assert.equal(
      isPassthroughWebpMeta({ format: 'jpeg', width: 800, height: 600 }, 100_000),
      false,
    );
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
