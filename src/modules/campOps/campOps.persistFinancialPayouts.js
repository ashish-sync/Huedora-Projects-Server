import {
  normalizeLifecycleStage,
  normalizePaymentSubmitStatus,
} from './campOps.lifecycle.js';

/** Confirmed Payment / Validation Completed camps in Financial stage. */
export function isConfirmedFinancialCamp(camp = {}) {
  if (normalizeLifecycleStage(camp.lifecycleStage, 'request') !== 'financial') return false;
  return normalizePaymentSubmitStatus(camp.paymentSubmitStatus) === 'payment_confirmed';
}

/**
 * Fields Financial → Save Changes typically materializes via applyCampBusinessLogic.
 * Used to decide whether a bulk save actually wrote anything.
 */
export function financialSaveSnapshot(camp = {}) {
  const n = (value) => Math.round((Number(value) || 0) * 100) / 100;
  return {
    campAmount: n(camp.campAmount),
    travelling: n(camp.travelling),
    overtimeExpense: n(camp.overtimeExpense),
    otherExpenses: n(camp.otherExpenses),
    totalPayout: n(camp.totalPayout),
    campRevenue: n(camp.campRevenue),
    travelRevenue: n(camp.travelRevenue),
    overtimeRevenue: n(camp.overtimeRevenue),
    otherRevenue: n(camp.otherRevenue),
    totalRevenue: n(camp.totalRevenue),
    netContribution: n(camp.netContribution),
    extraHours: n(camp.extraHours),
    totalHours: camp.totalHours == null || camp.totalHours === '' ? null : n(camp.totalHours),
    punctuality: String(camp.punctuality || ''),
    clientMasterCampDuration: String(camp.clientMasterCampDuration || ''),
  };
}

export function financialSaveChanged(before = {}, after = {}) {
  return Object.keys(before).some((key) => before[key] !== after[key]);
}
