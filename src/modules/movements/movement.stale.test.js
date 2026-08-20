import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNotStale } from '../../store/dataIntegrity.js';

test('assertNotStale ignores missing expected timestamp', () => {
  assert.doesNotThrow(() => assertNotStale({ updatedAt: '2020-01-01T00:00:00.000Z' }, null));
});

test('assertNotStale rejects mismatched updatedAt', () => {
  assert.throws(
    () =>
      assertNotStale(
        { updatedAt: '2020-01-02T00:00:00.000Z' },
        '2020-01-01T00:00:00.000Z',
        { label: 'Movement' }
      ),
    (err) => err.code === 'STALE_UPDATE' && err.status === 409
  );
});

test('assertNotStale accepts matching updatedAt', () => {
  const ts = '2020-01-02T00:00:00.000Z';
  assert.doesNotThrow(() => assertNotStale({ updatedAt: ts }, ts, { label: 'Movement' }));
});
