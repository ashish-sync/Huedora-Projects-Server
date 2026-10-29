import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { commercialDocumentDateRange } from './commercialDocumentDateRange.js';

describe('commercialDocumentDateRange', () => {
  it('returns null when both dates are empty', () => {
    assert.equal(commercialDocumentDateRange('', ''), null);
  });

  it('builds an inclusive from/to range', () => {
    assert.deepEqual(commercialDocumentDateRange('2026-10-01', '2026-10-28'), {
      $gte: '2026-10-01',
      $lte: '2026-10-28T23:59:59.999',
    });
  });

  it('swaps inverted dates', () => {
    assert.deepEqual(commercialDocumentDateRange('2026-10-28', '2026-10-01'), {
      $gte: '2026-10-01',
      $lte: '2026-10-28T23:59:59.999',
    });
  });

  it('allows an open-ended from date', () => {
    assert.deepEqual(commercialDocumentDateRange('2026-10-01', ''), {
      $gte: '2026-10-01',
    });
  });
});
