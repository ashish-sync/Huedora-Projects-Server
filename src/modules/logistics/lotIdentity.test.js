import test from 'node:test';
import assert from 'node:assert/strict';
import { stockLotIdentityKey } from './lotIdentity.js';

test('lot identity separates batch and expiry', () => {
  assert.notEqual(
    stockLotIdentityKey({ batchNumber: 'A', expiryDate: '2026-01-01' }),
    stockLotIdentityKey({ batchNumber: 'A', expiryDate: '2026-02-01' })
  );
  assert.notEqual(
    stockLotIdentityKey({ batchNumber: 'A', expiryDate: '2026-01-01' }),
    stockLotIdentityKey({ batchNumber: 'B', expiryDate: '2026-01-01' })
  );
  assert.equal(
    stockLotIdentityKey({ batchNumber: '  A ', expiryDate: '2026-01-01T00:00:00Z' }),
    stockLotIdentityKey({ batchNumber: 'A', expiryDate: '2026-01-01' })
  );
});
