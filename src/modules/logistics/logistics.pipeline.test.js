import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveGoodsIssuePipelineStage,
  GOODS_ISSUE_PIPELINE_STAGES,
  OUTWARD_PACKED_DISPATCH_STATUS,
  OUTWARD_POD_BOOKED_STATUS,
  OUTWARD_TERMINAL_DISPATCH_STATUSES,
  DEFAULT_STOCK_STATUSES,
  isOutwardDispatchInProgress,
  isOutwardDispatchTerminal,
} from './logistics.constants.js';

test('goods issue pipeline stages are ordered', () => {
  assert.equal(GOODS_ISSUE_PIPELINE_STAGES.length, 6);
  assert.equal(GOODS_ISSUE_PIPELINE_STAGES[0].id, 'booked');
  assert.equal(GOODS_ISSUE_PIPELINE_STAGES[5].id, 'outcome');
});

test('pipeline advances booked → approved → packed → pod → delivery → outcome', () => {
  assert.equal(resolveGoodsIssuePipelineStage({}).id, 'booked');
  assert.equal(resolveGoodsIssuePipelineStage({ requestStatus: 'REQUESTED' }).id, 'approved');
  assert.equal(resolveGoodsIssuePipelineStage({ requestStatus: 'APPROVED' }).id, 'packed');
  assert.equal(
    resolveGoodsIssuePipelineStage({
      requestStatus: 'APPROVED',
      packageStatus: 'Package ready',
    }).id,
    'pod'
  );
  assert.equal(
    resolveGoodsIssuePipelineStage({
      dispatchStatus: OUTWARD_PACKED_DISPATCH_STATUS,
    }).id,
    'pod'
  );
  assert.equal(
    resolveGoodsIssuePipelineStage({
      dispatchStatus: OUTWARD_POD_BOOKED_STATUS,
    }).id,
    'delivery'
  );
  assert.equal(
    resolveGoodsIssuePipelineStage({
      dispatchStatus: 'Delivered',
    }).outcome,
    'Delivered'
  );
  assert.equal(
    resolveGoodsIssuePipelineStage({
      deliveryOutcome: 'RTO',
    }).id,
    'outcome'
  );
  assert.equal(
    resolveGoodsIssuePipelineStage({ requestStatus: 'COMPLETED' }).id,
    'outcome'
  );
});

test('stock statuses are the simplified lot vocabulary', () => {
  assert.deepEqual(DEFAULT_STOCK_STATUSES, [
    'Available',
    'Reserved',
    'Issued',
    'Damaged',
    'Expired',
    'Disposed',
  ]);
});

test('dispatch in-progress vs terminal are mutually exclusive', () => {
  for (const s of ['Open', 'Packed', 'POD Booked', '']) {
    assert.equal(isOutwardDispatchInProgress(s), true);
    assert.equal(isOutwardDispatchTerminal(s), false);
  }
  for (const s of OUTWARD_TERMINAL_DISPATCH_STATUSES) {
    assert.equal(isOutwardDispatchTerminal(s), true);
    assert.equal(isOutwardDispatchInProgress(s), false);
  }
});
