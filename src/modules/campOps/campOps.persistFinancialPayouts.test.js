import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPayoutPersistOnly,
  financeAmountSnapshot,
  financeAmountsChanged,
  isConfirmedFinancialCamp,
} from './campOps.persistFinancialPayouts.js';

describe('persistFinancialPayouts helpers', () => {
  it('accepts Confirmed Payment / Validation Completed financial camps', () => {
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
    assert.equal(isConfirmedFinancialCamp({
      lifecycleStage: 'execution',
      paymentSubmitStatus: 'payment_confirmed',
    }), false);
  });

  it('seeds Camp Amount only and leaves status / revenue / travel untouched', () => {
    const camp = {
      status: 'executed',
      lifecycleStage: 'financial',
      executionStatus: 'Camp Completed',
      paymentSubmitStatus: 'payment_confirmed',
      financePaymentStatus: 'not_paid',
      campAmount: 0,
      travelling: 200,
      overtimeExpense: 50,
      otherExpenses: 25,
      totalPayout: 0,
      campRevenue: 8000,
      travelRevenue: 100,
      overtimeRevenue: 0,
      otherRevenue: 0,
      totalRevenue: 8100,
      netContribution: 8100,
    };
    const { changed } = applyPayoutPersistOnly(camp, { payeeAmount: 3500 });
    assert.equal(changed, true);
    assert.equal(camp.campAmount, 3500);
    assert.equal(camp.travelling, 200);
    assert.equal(camp.overtimeExpense, 50);
    assert.equal(camp.otherExpenses, 25);
    assert.equal(camp.totalPayout, 3775);
    assert.equal(camp.netContribution, 4325);
    assert.equal(camp.campRevenue, 8000);
    assert.equal(camp.travelRevenue, 100);
    assert.equal(camp.paymentSubmitStatus, 'payment_confirmed');
    assert.equal(camp.financePaymentStatus, 'not_paid');
    assert.equal(camp.lifecycleStage, 'financial');
  });

  it('does not overwrite an existing Camp Amount', () => {
    const camp = {
      status: 'executed',
      lifecycleStage: 'financial',
      executionStatus: 'Camp Completed',
      campAmount: 4200,
      travelling: 0,
      overtimeExpense: 0,
      otherExpenses: 0,
      totalPayout: 4200,
      totalRevenue: 9000,
      netContribution: 4800,
    };
    const { changed } = applyPayoutPersistOnly(camp, { payeeAmount: 3500 });
    assert.equal(changed, false);
    assert.equal(camp.campAmount, 4200);
    assert.equal(camp.totalPayout, 4200);
  });

  it('detects amount snapshot changes after seed', () => {
    const before = financeAmountSnapshot({
      campAmount: 0,
      travelling: 200,
      overtimeExpense: 0,
      otherExpenses: 0,
      totalPayout: 0,
      netContribution: 0,
    });
    const after = financeAmountSnapshot({
      campAmount: 3500,
      travelling: 200,
      overtimeExpense: 0,
      otherExpenses: 0,
      totalPayout: 3700,
      netContribution: 100,
    });
    assert.equal(financeAmountsChanged(before, after), true);
    assert.equal(financeAmountsChanged(after, { ...after }), false);
  });
});
