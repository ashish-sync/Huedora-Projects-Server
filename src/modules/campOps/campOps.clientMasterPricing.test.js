import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCampRevenueFromPricing,
  resolveClientMasterPricingFromRecords,
} from './campOps.clientMasterPricing.js';
import { computeLifecycleDerived } from './campOps.lifecycle.js';

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

test('other revenue is excess patients and kms over Client Master minimums', () => {
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
  assert.equal(result.otherRevenue, 200);
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

test('computeLifecycleDerived applies Client Master pricing when provided', () => {
  const derived = computeLifecycleDerived({
    status: 'executed',
    executionStatus: 'Camp Completed',
    chargeableStatus: 'Chargeable',
    inTime: '09:00',
    outTime: '14:00',
    durationHours: 4,
    actualPatients: 45,
    kmRoundTrip: 90,
    campRevenue: 1,
    overtimeRevenue: 1,
    otherRevenue: 1,
  }, { pricing });
  assert.equal(derived.extraHours, 1);
  assert.equal(derived.campRevenue, 5000);
  assert.equal(derived.overtimeRevenue, 400);
  assert.equal(derived.otherRevenuePatients, 0); // 45 < min 50
  assert.equal(derived.otherRevenueDistance, 0); // 90 < min 100
  assert.equal(derived.otherRevenue, 0);
  assert.equal(derived.totalRevenue, 5400);
  assert.equal(derived.revenueAutoCalculated, true);
});
