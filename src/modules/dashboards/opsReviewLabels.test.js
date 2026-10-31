import test from 'node:test';
import assert from 'node:assert/strict';
import {
  importKindLabel,
  importStatusLabel,
  notificationReadLabel,
  personStatusLabel,
} from './opsReviewLabels.js';

test('ops review labels stay business-facing', () => {
  assert.equal(personStatusLabel(true), 'Active');
  assert.equal(personStatusLabel(false), 'Not signing in');
  assert.equal(importKindLabel({ type: 'INVENTORY', mode: 'COMMIT' }), 'Saved asset register rows');
  assert.equal(importStatusLabel('FAILED'), 'Needs attention');
  assert.equal(notificationReadLabel(null), 'Waiting');
  assert.equal(notificationReadLabel('2026-10-31'), 'Seen');
});
