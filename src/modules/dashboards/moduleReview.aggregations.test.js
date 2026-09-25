import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewLimit,
  reviewFacetPipeline,
  facetTotal,
  facetCounts,
  dateRangeMatch,
} from './moduleReview.aggregations.js';
import {
  trackingVerificationByConditionPipeline,
  formatTrackingVerificationBuckets,
} from './dashboard.aggregations.js';

test('reviewLimit caps at 500 and defaults to 200', () => {
  assert.equal(reviewLimit({}), 200);
  assert.equal(reviewLimit({ limit: 999 }), 500);
  assert.equal(reviewLimit({ limit: 50 }), 50);
});

test('reviewFacetPipeline limits page rows and counts in facet', () => {
  const pipeline = reviewFacetPipeline({
    baseMatch: { isDeleted: false },
    dateFields: ['createdAt'],
    fromDate: new Date(2024, 0, 1),
    toDate: new Date(2024, 11, 31),
    limit: 200,
    groupField: 'status',
    rowProject: { _id: 1, status: 1, _reviewDate: 1 },
  });
  const facet = pipeline.find((s) => s.$facet);
  assert.ok(facet.$facet.total);
  assert.ok(facet.$facet.byField);
  assert.equal(facet.$facet.rows.find((s) => s.$limit).$limit, 200);
  assert.ok(!JSON.stringify(pipeline).includes('limit(2000)'));
});

test('facet helpers parse aggregate buckets', () => {
  assert.equal(facetTotal({ total: [{ n: 12 }] }), 12);
  assert.deepEqual(facetCounts({ byField: [{ _id: 'Open', count: 3 }] }), { Open: 3 });
  assert.equal(dateRangeMatch(null, null), null);
});

test('tracking verification pipeline groups conditions without projecting all assets', () => {
  const pipeline = trackingVerificationByConditionPipeline(
    null,
    null,
    'camp-1',
    new Date(2024, 5, 15),
  );
  const group = pipeline.find((s) => s.$group);
  assert.equal(group.$group._id, '$_condition');
  assert.ok(pipeline.some((s) => s.$lookup));
  assert.ok(pipeline.some((s) => s.$group));
});

test('formatTrackingVerificationBuckets fills SAFE/CAUTION/DANGER', () => {
  const { verification, verificationTotals } = formatTrackingVerificationBuckets([
    { _id: 'SAFE', qty: 2, value: 100 },
    { _id: 'DANGER', qty: 1, value: 50 },
  ]);
  assert.equal(verification[0].qty, 2);
  assert.equal(verification[1].qty, 0);
  assert.equal(verification[2].qty, 1);
  assert.equal(verificationTotals.qty, 3);
  assert.equal(verificationTotals.value, 150);
});
