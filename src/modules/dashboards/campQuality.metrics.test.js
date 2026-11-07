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

test('camp cycle rates overtime against planned duration', () => {
  assert.equal(
    classifyCampCycleBucket({ executionStatus: 'Cancelled by Client' }),
    'Cancelled',
  );
  assert.equal(classifyCampCycleBucket({}), 'Pending');
  assert.equal(
    classifyCampCycleBucket({
      inTime: '09:00',
      outTime: '13:00',
      clientMasterCampDuration: '4:00',
      durationHours: 4,
    }),
    'Good',
  );
  assert.equal(
    classifyCampCycleBucket({
      inTime: '09:00',
      outTime: '14:00',
      clientMasterCampDuration: '4:00',
      durationHours: 4,
    }),
    'Average',
  );
  assert.equal(
    classifyCampCycleBucket({
      inTime: '09:00',
      outTime: '15:00',
      clientMasterCampDuration: '4:00',
      durationHours: 4,
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
