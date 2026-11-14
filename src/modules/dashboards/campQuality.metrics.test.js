import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAttireBucket,
  classifyChargeabilityBucket,
  classifyPunctualityBucket,
  classifyCampCycleBucket,
  classifyAvgPayoutBucket,
  summarizeCampQualityCamps,
  CAMP_QUALITY_METRICS,
} from './campQuality.metrics.js';

test('attire maps Issues/No Issues to Welcome bucket labels', () => {
  assert.equal(classifyAttireBucket('Issues'), 'Issue');
  assert.equal(classifyAttireBucket('No Issues'), 'No Issue');
  assert.equal(classifyAttireBucket(''), 'Pending');
});

test('chargeability maps Partial to Chargeable and blanks to Pending', () => {
  assert.equal(classifyChargeabilityBucket('Chargeable'), 'Chargeable');
  assert.equal(classifyChargeabilityBucket('Non-Chargeable'), 'Non-Chargeable');
  assert.equal(classifyChargeabilityBucket('Partial'), 'Chargeable');
  assert.equal(classifyChargeabilityBucket(''), 'Pending');
});

test('punctuality uses cancellation and stored/derived ratings', () => {
  assert.equal(
    classifyPunctualityBucket({ executionStatus: 'Cancelled by Tylo' }),
    'Cancelled',
  );
  assert.equal(classifyPunctualityBucket({ punctuality: 'Good' }), 'Good');
  assert.equal(
    classifyPunctualityBucket({ startTime: '09:00', inTime: '09:20' }),
    'Poor',
  );
  assert.equal(classifyPunctualityBucket({}), 'Pending');
});

test('camp cycle uses camp end → Confirm Payment working hours', () => {
  assert.equal(
    classifyCampCycleBucket({ executionStatus: 'Cancelled by Client' }),
    'Cancelled',
  );
  assert.equal(classifyCampCycleBucket({}), 'Pending');
  assert.equal(
    classifyCampCycleBucket({
      campDate: '2026-11-10',
      outTime: '13:00',
    }),
    'Pending',
  );
  // Tue 13:00 → same day 18:00 = 5 working hours → Good
  assert.equal(
    classifyCampCycleBucket({
      campDate: '2026-11-10',
      outTime: '13:00',
      paymentConfirmedAt: '2026-11-10T12:30:00.000Z', // 18:00 IST
    }),
    'Good',
  );
  // Tue 13:00 → Thu 14:00 IST spans >16 and ≤32 working hours → Average
  assert.equal(
    classifyCampCycleBucket({
      campDate: '2026-11-10',
      outTime: '13:00',
      paymentConfirmedAt: '2026-11-12T08:30:00.000Z', // Thu 14:00 IST
    }),
    'Average',
  );
  // Tue 13:00 → next week → Poor
  assert.equal(
    classifyCampCycleBucket({
      campDate: '2026-11-10',
      outTime: '13:00',
      paymentConfirmedAt: '2026-11-17T12:30:00.000Z',
    }),
    'Poor',
  );
});

test('avg payout buckets cancelled, empty, and amount camps', () => {
  assert.equal(
    classifyAvgPayoutBucket({ executionStatus: 'Cancelled by Tylo' }),
    'Cancelled',
  );
  assert.equal(classifyAvgPayoutBucket({}), 'Pending');
  assert.equal(
    classifyAvgPayoutBucket({ campAmount: 3500 }),
    'Amount',
  );
});

test('summarizeCampQualityCamps returns ordered bucket counts and average payout', () => {
  const camps = [
    { punctuality: 'Good', campAmount: 2000 },
    { punctuality: 'Average', campAmount: 4000 },
    { executionStatus: 'Cancelled by Tylo' },
    {},
  ];

  const punctuality = summarizeCampQualityCamps(CAMP_QUALITY_METRICS.punctuality, camps);
  assert.deepEqual(
    punctuality.buckets.map((b) => [b.key, b.count]),
    [
      ['Pending', 1],
      ['Cancelled', 1],
      ['Good', 1],
      ['Average', 1],
      ['Poor', 0],
    ],
  );

  const payout = summarizeCampQualityCamps(CAMP_QUALITY_METRICS.avgPayout, camps);
  assert.equal(payout.summary.averageAmount, 3000);
  assert.equal(payout.summary.amountCount, 2);
  assert.deepEqual(
    payout.buckets.map((b) => [b.key, b.count]),
    [
      ['Pending', 1],
      ['Cancelled', 1],
      ['Amount', 2],
    ],
  );
});
