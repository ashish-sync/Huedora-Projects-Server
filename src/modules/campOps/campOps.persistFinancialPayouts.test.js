import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  financialSaveChanged,
  financialSaveSnapshot,
  isConfirmedFinancialCamp,
} from './campOps.persistFinancialPayouts.js';

describe('bulk Financial Save helpers', () => {
  it('accepts Confirmed Payment financial camps only', () => {
    assert.equal(isConfirmedFinancialCamp({
      lifecycleStage: 'financial',
      paymentSubmitStatus: 'payment_confirmed',
    }), true);
    assert.equal(isConfirmedFinancialCamp({
      lifecycleStage: 'financial',
      paymentSubmitStatus: 'validation_completed',
    }), true);
    assert.equal(isConfirmedFinancialCamp({
      lifecycleStage: 'financial',
      paymentSubmitStatus: 'payment_not_checked',
    }), false);
  });

  it('detects Save Changes materialization of Camp Amount / totals', () => {
    const before = financialSaveSnapshot({
      campAmount: 0,
      travelling: 200,
      totalPayout: 0,
      totalRevenue: 8000,
      netContribution: 8000,
    });
    const after = financialSaveSnapshot({
      campAmount: 3500,
      travelling: 200,
      totalPayout: 3700,
      totalRevenue: 8000,
      netContribution: 4300,
    });
    assert.equal(financialSaveChanged(before, after), true);
    assert.equal(financialSaveChanged(after, { ...after }), false);
  });
});
