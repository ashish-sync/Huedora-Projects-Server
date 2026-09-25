import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getListIndexStatus,
  markListIndexesFailed,
} from '../store/persistence.js';

test('markListIndexesFailed surfaces on getListIndexStatus', () => {
  markListIndexesFailed('boom');
  const status = getListIndexStatus();
  assert.equal(status.ok, false);
  assert.equal(status.skipped, false);
  assert.equal(status.failed[0].index, 'ensure');
  assert.match(status.failed[0].error, /boom/);
  assert.ok(status.ensuredAt);
});
