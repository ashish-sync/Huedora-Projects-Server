import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCampRevenueFromPricing,
  looksLikeStaleScheduledOvertime,
  resolveClientMasterPricingFromRecords,
  seedCampRevenueFromPricing,
} from './campOps.clientMasterPricing.js';
import {
  applyCampBusinessLogic,
  campSnapshotPricing,
  computeLifecycleDerived,
  lifecyclePayloadFromBody,
} from './campOps.lifecycle.js';

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

test('cancelled by Tylo/Client chargeable uses cancelledCampUnit', () => {
  for (const executionStatus of ['Cancelled by Tylo', 'Cancelled by Client']) {
    const result = computeCampRevenueFromPricing({
      status: 'cancelled',
      executionStatus,
      chargeableStatus: 'Chargeable',
    }, pricing);
    assert.equal(result.campRevenue, 2000, executionStatus);
  }
});

test('non-chargeable executed camp revenue is zero; OT still applies', () => {
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

test('cancelled non-chargeable always zeros all financial units', () => {
  const result = computeCampRevenueFromPricing({
    status: 'cancelled',
    executionStatus: 'Cancelled by Client',
    chargeableStatus: 'Non-Chargeable',
    totalHours: 6,
    durationHours: 4,
    actualPatients: 80,
    kmRoundTrip: 200,
  }, pricing);
  assert.equal(result.campRevenue, 0);
  assert.equal(result.travelRevenue, 0);
  assert.equal(result.overtimeRevenue, 0);
  assert.equal(result.otherRevenue, 0);
  assert.equal(result.totalRevenue, 0);
});

test('seedCampRevenueFromPricing fills empty executed chargeable from Client Master', () => {
  const camp = {
    status: 'executed',
    executionStatus: 'Camp Completed',
    chargeableStatus: 'Chargeable',
    totalHours: 4,
  };
  seedCampRevenueFromPricing(camp, pricing);
  assert.equal(camp.campRevenue, 5000);
  assert.equal(camp.totalRevenue, 5000);
});

test('seedCampRevenueFromPricing forces zero for cancelled non-chargeable even if stored', () => {
  const camp = {
    status: 'cancelled',
    executionStatus: 'Cancelled by Tylo',
    chargeableStatus: 'Non-Chargeable',
    campRevenue: 2000,
    overtimeRevenue: 100,
    totalRevenue: 2100,
  };
  seedCampRevenueFromPricing(camp, pricing);
  assert.equal(camp.campRevenue, 0);
  assert.equal(camp.overtimeRevenue, 0);
  assert.equal(camp.totalRevenue, 0);
});

test('stale overtime matches the old scheduled-slot Extra hours formula', () => {
  const camp = {
    totalHours: 6,
    durationHours: 3,
    extraHours: 3,
    overtimeRevenue: 1200, // 3h × 400
    clientMasterCampDuration: '',
  };
  assert.equal(looksLikeStaleScheduledOvertime(camp, pricing), true);
  const derived = computeLifecycleDerived({
    ...camp,
    inTime: '09:00',
    outTime: '15:00',
  }, { pricing });
  assert.equal(derived.extraHours, 2);
  assert.equal(derived.overtimeRevenue, 800);
});

test('applyCampBusinessLogic backfills Extra hours on existing camps without rewriting campId', () => {
  const camp = {
    campId: '26-10-1326',
    inTime: '09:00',
    outTime: '15:00',
    durationHours: 3,
    extraHours: 3,
    overtimeRevenue: 1200,
    campRevenue: 5000,
    travelRevenue: 0,
    otherRevenue: 0,
    campAmount: 0,
    executionStatus: 'Camp Completed',
  };
  const { changed } = applyCampBusinessLogic(camp, { pricing, payeeAmount: 2500 });
  assert.equal(changed, true);
  assert.equal(camp.campId, '26-10-1326');
  assert.equal(camp.clientMasterCampDuration, '4:00');
  assert.equal(camp.extraHours, 2);
  assert.equal(camp.overtimeRevenue, 800);
  assert.equal(camp.campAmount, 2500);
  assert.equal(camp.totalPayout, 2500);
});

test('applyCampBusinessLogic is idempotent and keeps a manual overtime override', () => {
  const camp = {
    campId: '26-10-0001',
    inTime: '09:00',
    outTime: '15:00',
    durationHours: 3,
    extraHours: 2,
    clientMasterCampDuration: '4:00',
    overtimeRevenue: 333,
    campRevenue: 5000,
    campAmount: 1800,
    executionStatus: 'Camp Completed',
  };
  const first = applyCampBusinessLogic(camp, { pricing, payeeAmount: 2500 });
  assert.equal(camp.overtimeRevenue, 333);
  assert.equal(camp.campAmount, 1800);
  const second = applyCampBusinessLogic(camp, { pricing, payeeAmount: 2500 });
  assert.equal(second.changed, false);
  assert.equal(camp.campId, '26-10-0001');
  void first;
});

test('campSnapshotPricing uses the stored duration so exports and finance match GET overlay', () => {
  const derived = computeLifecycleDerived({
    inTime: '09:00',
    outTime: '15:00',
    durationHours: 3,
    extraHours: 3,
    clientMasterCampDuration: '4:00',
  }, { pricing: campSnapshotPricing({ clientMasterCampDuration: '4:00' }) });
  assert.equal(derived.extraHours, 2);
});

test('existing camp extra hours uses stored Client Master duration without live pricing', () => {
  const derived = computeLifecycleDerived({
    inTime: '09:00',
    outTime: '15:00',
    durationHours: 3,
    extraHours: 3, // previously persisted with scheduled-slot math
    clientMasterCampDuration: '4:00',
  });
  assert.equal(derived.totalHours, 6);
  assert.equal(derived.extraHours, 2);
});

test('new and existing camps both recompute extra hours from live Client Master pricing', () => {
  const existing = computeLifecycleDerived({
    inTime: '09:00',
    outTime: '15:00',
    durationHours: 3,
    extraHours: 3,
  }, { pricing });
  const created = computeLifecycleDerived({
    inTime: '09:00',
    outTime: '15:00',
    durationHours: 3,
  }, { pricing });
  assert.equal(existing.extraHours, 2);
  assert.equal(created.extraHours, 2);
});

test('lifecyclePayloadFromBody snapshots Client Master duration onto new and existing camps', () => {
  const created = lifecyclePayloadFromBody(
    { inTime: '09:00', outTime: '15:00', durationHours: 3 },
    null,
    { pricing },
  );
  assert.equal(created.clientMasterCampDuration, '4:00');
  assert.equal(created.extraHours, 2);

  const updated = lifecyclePayloadFromBody(
    { inTime: '09:00', outTime: '15:00' },
    { durationHours: 3, extraHours: 3, clientMasterCampDuration: '' },
    { pricing },
  );
  assert.equal(updated.clientMasterCampDuration, '4:00');
  assert.equal(updated.extraHours, 2);
});

test('computeLifecycleDerived extra hours uses Client Master duration, not scheduled slot', () => {
  const derived = computeLifecycleDerived({
    inTime: '09:00',
    outTime: '15:00',
    durationHours: 3, // scheduled 09:00–12:00 — must not drive OT
  }, { pricing });
  assert.equal(derived.totalHours, 6);
  assert.equal(derived.extraHours, 2);
});

test('computeLifecycleDerived extra hours updates when out time changes', () => {
  const first = computeLifecycleDerived({
    inTime: '09:00',
    outTime: '13:00',
    durationHours: 3,
  }, { pricing });
  assert.equal(first.totalHours, 4);
  assert.equal(first.extraHours, 0);

  const later = computeLifecycleDerived({
    inTime: '09:00',
    outTime: '15:00',
    durationHours: 3,
  }, { pricing });
  assert.equal(later.totalHours, 6);
  assert.equal(later.extraHours, 2);
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
  assert.equal(next.totalPayout, 1000);
  assert.equal(next.netContribution, 3725);
});

test('lifecyclePayloadFromBody ignores Camp/Travel/OT payout edits on cancelled-by camps', () => {
  const next = lifecyclePayloadFromBody(
    {
      campAmount: 9999,
      travelling: 500,
      overtimeExpense: 250,
      otherExpenses: 150,
      totalPayout: 10899,
    },
    {
      lifecycleStage: 'financial',
      status: 'cancelled',
      executionStatus: 'Cancelled by Tylo',
      campAmount: 0,
      travelling: 0,
      overtimeExpense: 0,
      otherExpenses: 0,
    },
  );
  assert.equal(Object.prototype.hasOwnProperty.call(next, 'campAmount'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(next, 'travelling'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(next, 'overtimeExpense'), false);
  assert.equal(next.otherExpenses, 150);
  assert.equal(next.totalPayout, 150);
});

test('lifecyclePayloadFromBody recomputes totalPayout from parts when body totalPayout is stale zero', () => {
  const next = lifecyclePayloadFromBody(
    {
      campAmount: 2500,
      travelling: 0,
      overtimeExpense: 0,
      otherExpenses: 0,
      totalPayout: 0,
    },
    { lifecycleStage: 'financial' },
  );
  assert.equal(next.campAmount, 2500);
  assert.equal(next.totalPayout, 2500);
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
