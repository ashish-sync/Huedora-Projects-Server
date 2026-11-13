import {
  isCampExecutedForPayout,
  normalizeLifecycleStage,
  normalizePaymentSubmitStatus,
} from './campOps.lifecycle.js';

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Confirmed Payment / Validation Completed camps in Financial stage. */
export function isConfirmedFinancialCamp(camp = {}) {
  if (normalizeLifecycleStage(camp.lifecycleStage, 'request') !== 'financial') return false;
  return normalizePaymentSubmitStatus(camp.paymentSubmitStatus) === 'payment_confirmed';
}

/** Payout fields only — never revenue, status, lifecycle, or execution. */
export function financeAmountSnapshot(camp = {}) {
  const n = (value) => Math.round((Number(value) || 0) * 100) / 100;
  return {
    campAmount: n(camp.campAmount),
    travelling: n(camp.travelling),
    overtimeExpense: n(camp.overtimeExpense),
    otherExpenses: n(camp.otherExpenses),
    totalPayout: n(camp.totalPayout),
    netContribution: n(camp.netContribution),
  };
}

export function financeAmountsChanged(before = {}, after = {}) {
  return Object.keys(before).some((key) => before[key] !== after[key]);
}

/**
 * Same effect as opening Financial and Save Changes for payout columns:
 * - Seed Camp Amount from Contact Directory only when empty (Executed camps)
 * - Keep Travelling / Overtime / Other Expenses as already stored
 * - Recompute totalPayout + netContribution
 * Does not change payment status, lifecycle, revenue, hours, or assignment.
 */
export function applyPayoutPersistOnly(camp, { payeeAmount = null } = {}) {
  if (!camp) return { changed: false };
  const before = financeAmountSnapshot(camp);

  if (isCampExecutedForPayout(camp) && !(num(camp.campAmount) > 0)) {
    const amount = num(payeeAmount);
    if (amount > 0) {
      camp.campAmount = amount;
    }
  }

  camp.totalPayout = Math.round((
    num(camp.campAmount) + num(camp.travelling) + num(camp.overtimeExpense) + num(camp.otherExpenses)
  ) * 100) / 100;
  camp.netContribution = Math.round((num(camp.totalRevenue) - num(camp.totalPayout)) * 100) / 100;

  return {
    changed: financeAmountsChanged(before, financeAmountSnapshot(camp)),
  };
}
