import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCampRevenueFromPricing,
  resolveClientMasterPricingFromRecords,
} from './campOps.clientMasterPricing.js';
import { computeLifecycleDerived, lifecyclePayloadFromBody } from './campOps.lifecycle.js';

const pricing = {
  executedCampUnit: 5000,
  cancelledCampUnit: 2000,
  otUnit: 400,
  minimumPatientCovered: 50,
  minimumKmsCovered: 100,
  extPatientUnit: 10,
  kmsUnit: 5,
  campDuration: '4:00',
};

test('resolveClientMasterPricingFromRecords prefers exact division + method', () => {
  const units = resolveClientMasterPricingFromRecords([
    { programName: 'Cardio', campName: 'BMD', executedCampUnit: 1, isActive: true },
    { programName: 'Cardio', campName: 'Dietician', executedCampUnit: 9, isActive: true },
  ], { campaignType: 'Cardio', campaignName: 'Dietician' });
  assert.equal(units.executedCampUnit, 9);
});

test('overtime revenue is (Total Hours − Camp Duration) × OT Unit', () => {
  const result = computeCampRevenueFromPricing({
    status: 'executed',
    executionStatus: 'Camp Completed',
    chargeableStatus: 'Chargeable',
    totalHours: 5.5,
    durationHours: 99, // ignored when Client Master campDuration is set
  }, { ...pricing, campDuration: '4:30', otUnit: 200 });
  // (5.5 − 4.5) × 200 = 200
  assert.equal(result.overtimeRevenue, 200);
});

test('camp revenue uses executed unit when chargeable and executed', () => {
  const result = computeCampRevenueFromPricing({
    status: 'executed',
    executionStatus: 'Camp Completed',
    chargeableStatus: 'Chargeable',
    totalHours: 5,
    durationHours: 4,
    actualPatients: 40,
    kmRoundTrip: 80,
  }, pricing);
  assert.equal(result.campRevenue, 5000);
  assert.equal(result.overtimeRevenue, 400); // (5 − 4) × 400
  assert.equal(result.otherRevenuePatients, 0); // screened 40 < min 50
  assert.equal(result.otherRevenueDistance, 0); // kms 80 < min 100
  assert.equal(result.otherRevenue, 0);
  assert.equal(result.totalRevenue, 5400);
});

test('other revenue is patient excess; travel revenue is kms excess', () => {
  const result = computeCampRevenueFromPricing({
    status: 'executed',
    executionStatus: 'Camp Completed',
    chargeableStatus: 'Chargeable',
    totalHours: 4,
    actualPatients: 60,
    kmRoundTrip: 120,
  }, pricing);
  assert.equal(result.otherRevenuePatients, 100); // (60 − 50) × 10
  assert.equal(result.otherRevenueDistance, 100); // (120 − 100) × 5
  assert.equal(result.travelRevenue, 100);
  assert.equal(result.otherRevenue, 100);
  assert.equal(result.totalRevenue, 5200); // 5000 camp + 100 travel + 100 other
});

test('camp revenue uses cancelled unit when chargeable and cancelled', () => {
  const result = computeCampRevenueFromPricing({
    status: 'cancelled',
    chargeableStatus: 'Chargeable',
  }, pricing);
  assert.equal(result.campRevenue, 2000);
});

test('non-chargeable camp revenue is zero', () => {
  const result = computeCampRevenueFromPricing({
    status: 'executed',
    executionStatus: 'Camp Completed',
    chargeableStatus: 'Non-Chargeable',
    totalHours: 6,
    durationHours: 4,
  }, pricing);
  assert.equal(result.campRevenue, 0);
  assert.equal(result.overtimeRevenue, 800);
});

test('computeLifecycleDerived keeps stored revenue when Client Master pricing is provided', () => {
  const derived = computeLifecycleDerived({
    status: 'executed',
    executionStatus: 'Camp Completed',
    chargeableStatus: 'Chargeable',
    inTime: '09:00',
    outTime: '14:00',
    durationHours: 4,
    actualPatients: 45,
    kmRoundTrip: 90,
    campRevenue: 1111,
    travelRevenue: 222,
    overtimeRevenue: 333,
    otherRevenue: 44,
  }, { pricing });
  assert.equal(derived.extraHours, 1);
  assert.equal(derived.campRevenue, 1111);
  assert.equal(derived.travelRevenue, 222);
  assert.equal(derived.overtimeRevenue, 333);
  assert.equal(derived.otherRevenue, 44);
  assert.equal(derived.totalRevenue, 1710);
  assert.equal(derived.formulaCampRevenue, 5000);
  assert.equal(derived.formulaOvertimeRevenue, 400);
  assert.equal(derived.formulaTotalRevenue, 5400);
  assert.equal(derived.revenueAutoCalculated, true);
});

test('lifecyclePayloadFromBody preserves manual revenue overrides even with pricing', () => {
  const next = lifecyclePayloadFromBody(
    {
      campRevenue: 4500,
      travelRevenue: 150,
      overtimeRevenue: 50,
      otherRevenue: 25,
      totalRevenue: 4725,
      campAmount: 1000,
      travelling: 0,
      overtimeExpense: 0,
      otherExpenses: 0,
    },
    {
      lifecycleStage: 'financial',
      status: 'executed',
      executionStatus: 'Camp Completed',
      chargeableStatus: 'Chargeable',
      inTime: '09:00',
      outTime: '14:00',
      durationHours: 4,
      actualPatients: 45,
      kmRoundTrip: 90,
    },
    { pricing },
  );
  assert.equal(next.campRevenue, 4500);
  assert.equal(next.travelRevenue, 150);
  assert.equal(next.overtimeRevenue, 50);
  assert.equal(next.otherRevenue, 25);
  assert.equal(next.totalRevenue, 4725);
  assert.equal(next.netContribution, 3725);
});

test('net contribution is total revenue minus total payout', () => {
  const derived = computeLifecycleDerived({
    campRevenue: 5000,
    travelRevenue: 200,
    overtimeRevenue: 100,
    otherRevenue: 50,
    campAmount: 3000,
    travelling: 400,
    overtimeExpense: 100,
    otherExpenses: 50,
  });
  assert.equal(derived.totalRevenue, 5350);
  assert.equal(derived.totalPayout, 3550);
  assert.equal(derived.netContribution, 1800);
});

test('lifecyclePayloadFromBody preserves explicit total overrides and net contribution', () => {
  const next = lifecyclePayloadFromBody(
    {
      campAmount: 1000,
      travelling: 0,
      overtimeExpense: 0,
      otherExpenses: 0,
      totalPayout: 2500,
      campRevenue: 4000,
      travelRevenue: 0,
      overtimeRevenue: 0,
      otherRevenue: 0,
      totalRevenue: 4100,
    },
    { lifecycleStage: 'financial' },
  );
  assert.equal(next.totalPayout, 2500);
  assert.equal(next.totalRevenue, 4100);
  assert.equal(next.netContribution, 1600);
});
