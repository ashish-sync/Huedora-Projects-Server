import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countCampsByClientNames,
  purgeCampsByClientNames,
} from './purgeAllCamps.js';

// Lightweight unit-style checks of the filter helpers via exported API shapes.
// Full DB coverage is exercised by the script dry-run against Mongo.

test('purgeCampsByClientNames returns empty result for blank names', async () => {
  const result = await purgeCampsByClientNames(['', '  '], { actorId: 'test' });
  assert.equal(result.purged, 0);
  assert.equal(result.matched, 0);
  assert.deepEqual(result.clientNames, []);
});

test('countCampsByClientNames returns empty for blank names', async () => {
  const result = await countCampsByClientNames([]);
  assert.equal(result.total, 0);
  assert.deepEqual(result.byClient, {});
});
