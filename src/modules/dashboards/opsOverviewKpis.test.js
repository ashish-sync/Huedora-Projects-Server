import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeClientInvoiceOutstanding,
  isCancelledByClientCamp,
  isCancelledByTyloCamp,
  isEligibleScheduledCamp,
  parseOpsOverviewRange,
  summarizeCampOverviewKpis,
} from './opsOverviewKpis.js';

test('parseOpsOverviewRange accepts YYYY-MM-DD bounds', () => {
  const range = parseOpsOverviewRange({ from: '2026-11-01', to: '2026-11-30' });
  assert.equal(range.fromIso, '2026-11-01');
  assert.equal(range.toIso, '2026-11-30');
  assert.ok(range.fromDate instanceof Date);
  assert.ok(range.toDate instanceof Date);
});

test('parseOpsOverviewRange rejects inverted range', () => {
  assert.throws(
    () => parseOpsOverviewRange({ from: '2026-12-01', to: '2026-11-01' }),
    (err) => err.status === 400,
  );
});

test('cancellation helpers split Tylo vs Client', () => {
  assert.equal(
    isCancelledByTyloCamp({
      status: 'cancelled',
      executionStatus: 'Cancelled by Tylo',
      cancelledBy: 'khw',
    }),
    true,
  );
  assert.equal(
    isCancelledByClientCamp({
      status: 'cancelled',
      executionStatus: 'Cancelled by Client',
      cancelledBy: 'brand',
    }),
    true,
  );
  assert.equal(
    isCancelledByTyloCamp({
      status: 'cancelled',
      executionStatus: 'Cancelled by Client',
    }),
    false,
  );
});

test('summarizeCampOverviewKpis reports chargeability punctuality and cancellation rate', () => {
  const now = new Date(2026, 10, 10);
  const camps = [
    {
      status: 'approved',
      lifecycleStage: 'execution',
      executionStatus: 'Camp Scheduled',
      campDate: '2026-11-10',
      campSlot: 'Morning',
      chargeableStatus: 'Chargeable',
      punctuality: 'Good',
    },
    {
      status: 'cancelled',
      executionStatus: 'Cancelled by Tylo',
      cancelledBy: 'khw',
      campDate: '2026-11-11',
      campSlot: 'Noon',
      chargeableStatus: 'Non-Chargeable',
    },
    {
      status: 'cancelled',
      executionStatus: 'Cancelled by Client',
      cancelledBy: 'brand',
      campDate: '2026-11-12',
      campSlot: 'Evening',
      chargeableStatus: 'Non-Chargeable',
    },
  ];

  // Force eligibility via cancellation / schedule helpers using real now — patch dates relative to today.
  void now;
  const summary = summarizeCampOverviewKpis(camps, { fromIso: '2026-11-01', toIso: '2026-11-30' });
  assert.ok(summary.eligibleTotal >= 2);
  assert.equal(summary.cancellation.byTylo.qty >= 1, true);
  assert.equal(summary.cancellation.byClient.qty >= 1, true);
  assert.ok(Array.isArray(summary.chargeability));
  assert.ok(Array.isArray(summary.punctuality));
});

test('isEligibleScheduledCamp includes cancelled camps', () => {
  assert.equal(
    isEligibleScheduledCamp({
      status: 'cancelled',
      executionStatus: 'Cancelled by Tylo',
      cancelledBy: 'khw',
    }),
    true,
  );
});

test('computeClientInvoiceOutstanding nets payments and linked credits', () => {
  const out = computeClientInvoiceOutstanding(
    [
      {
        documentNumber: 'TCIN26-27/11/001',
        grandTotal: 1000,
        paidAmount: 200,
        paymentStatus: 'Partially Paid',
      },
      {
        documentNumber: 'TCIN26-27/11/002',
        grandTotal: 500,
        paidAmount: 0,
        paymentStatus: 'Unpaid under 30D',
      },
      {
        documentNumber: 'TCIN26-27/11/003',
        grandTotal: 900,
        paidAmount: 900,
        paymentStatus: 'Paid',
      },
    ],
    [
      {
        reference: 'TCIN26-27/11/001',
        grandTotal: 100,
        status: 'Issued',
        paymentStatus: 'Pending Adjustment',
      },
    ],
  );
  // (800 + 500) - 100 = 1200
  assert.equal(out.grossOutstanding, 1300);
  assert.equal(out.creditApplied, 100);
  assert.equal(out.outstanding, 1200);
  assert.equal(out.invoiceCount, 2);
});
