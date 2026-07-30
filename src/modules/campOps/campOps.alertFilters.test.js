import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampFilter } from './campOps.helpers.js';

test('buildCampFilter supports off-hours pending review filter', () => {
  const filter = buildCampFilter({ offHours: '1' });
  assert.equal(filter.status, 'pending_review');
  assert.equal(filter.submittedOffHours, true);
});

test('buildCampFilter supports weekend attention pending review filter', () => {
  const filter = buildCampFilter({ weekendAttention: '1' });
  assert.equal(filter.status, 'pending_review');
  assert.equal(filter.submittedWeekendAttention, true);
});
