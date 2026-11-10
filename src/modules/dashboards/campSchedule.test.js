import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addLocalDaysIso,
  buildCampScheduleMatrix,
  endOfMonthIso,
  isCampScheduleEligible,
  resolveScheduleSlot,
  toLocalDateIso,
} from './campSchedule.js';

function approvedAssignment(overrides = {}) {
  return {
    status: 'approved',
    lifecycleStage: 'assignment',
    assignmentStatus: 'Unassigned',
    campSlot: 'Morning',
    ...overrides,
  };
}

test('resolveScheduleSlot uses stored Camp Slot only (no startTime math)', () => {
  assert.equal(resolveScheduleSlot({ campSlot: 'Noon', startTime: '09:00' }), 'Noon');
  assert.equal(resolveScheduleSlot({ campSlot: 'Afternoon', startTime: '09:00' }), 'Noon');
  assert.equal(resolveScheduleSlot({ campSlot: '', startTime: '14:00' }), '');
  assert.equal(resolveScheduleSlot({ campSlot: 'Evening' }), 'Evening');
});

test('eligibility includes Planned / Unassigned / Hiring Requested / Executed; excludes refused cancelled unapproved hold', () => {
  const now = new Date(2026, 10, 10);

  assert.equal(
    isCampScheduleEligible(approvedAssignment({ assignmentStatus: 'Unassigned' }), now),
    true,
  );
  assert.equal(
    isCampScheduleEligible(
      approvedAssignment({ assignmentStatus: 'Hiring Requested' }),
      now,
    ),
    true,
  );
  assert.equal(
    isCampScheduleEligible(
      {
        status: 'approved',
        lifecycleStage: 'execution',
        executionStatus: 'Camp Scheduled',
        campSlot: 'Morning',
      },
      now,
    ),
    true,
  );
  assert.equal(
    isCampScheduleEligible(
      {
        status: 'approved',
        lifecycleStage: 'execution',
        executionStatus: 'Marked Executed',
        campSlot: 'Morning',
      },
      now,
    ),
    true,
  );
  assert.equal(
    isCampScheduleEligible(
      {
        status: 'approved',
        lifecycleStage: 'financial',
        paymentSubmitStatus: 'payment_confirmed',
        campSlot: 'Morning',
      },
      now,
    ),
    true,
  );

  assert.equal(
    isCampScheduleEligible(
      {
        status: 'pending_review',
        lifecycleStage: 'request',
        requestReviewStatus: 'review_pending',
        campSlot: 'Morning',
      },
      now,
    ),
    false,
  );
  assert.equal(
    isCampScheduleEligible(
      {
        status: 'rejected',
        lifecycleStage: 'request',
        requestReviewStatus: 'request_rejected',
        campSlot: 'Morning',
      },
      now,
    ),
    false,
  );
  assert.equal(
    isCampScheduleEligible(
      {
        status: 'cancelled',
        lifecycleStage: 'execution',
        executionStatus: 'Cancelled by Tylo',
        campSlot: 'Morning',
      },
      now,
    ),
    false,
  );
  assert.equal(
    isCampScheduleEligible(
      {
        status: 'approved',
        lifecycleStage: 'financial',
        paymentSubmitStatus: 'payment_hold',
        campSlot: 'Morning',
      },
      now,
    ),
    false,
  );
});

test('camp schedule buckets Day 0 / Day 1 / Day 2 / EOM with unique Camp IDs', () => {
  const now = new Date(2026, 10, 10); // 10 Nov 2026
  const today = toLocalDateIso(now);
  const tomorrow = addLocalDaysIso(today, 1);
  const dayAfter = addLocalDaysIso(today, 2);
  const dayThree = addLocalDaysIso(today, 3);
  const laterThisMonth = '2026-11-25';
  const nextMonth = '2026-12-01';

  const matrix = buildCampScheduleMatrix(
    [
      approvedAssignment({ campId: 'C1', campDate: today, campSlot: 'Morning' }),
      // Duplicate Camp ID must not double-count Day 0 Morning
      approvedAssignment({ campId: 'C1', campDate: today, campSlot: 'Morning' }),
      approvedAssignment({
        campId: 'C2',
        campDate: today,
        campSlot: 'Noon',
        assignmentStatus: 'Hiring Requested',
      }),
      approvedAssignment({
        campId: 'C3',
        campDate: tomorrow,
        campSlot: 'Evening',
        lifecycleStage: 'execution',
        executionStatus: 'Camp Scheduled',
      }),
      approvedAssignment({
        campId: 'C4',
        campDate: dayAfter,
        campSlot: 'Morning',
        lifecycleStage: 'execution',
        executionStatus: 'Marked Executed',
      }),
      approvedAssignment({ campId: 'C5', campDate: laterThisMonth, campSlot: 'Morning' }),
      approvedAssignment({ campId: 'C6', campDate: nextMonth, campSlot: 'Morning' }),
      // Excluded
      {
        campId: 'CX',
        campDate: today,
        campSlot: 'Morning',
        status: 'cancelled',
        lifecycleStage: 'execution',
        executionStatus: 'Cancelled by Client',
      },
      // No stored slot — ignored (no time derivation)
      approvedAssignment({ campId: 'C7', campDate: today, campSlot: '', startTime: '14:00' }),
    ],
    now,
  );

  assert.equal(matrix.dates.today, '2026-11-10');
  assert.equal(matrix.dates.tomorrow, '2026-11-11');
  assert.equal(matrix.dates.dayAfter, '2026-11-12');
  assert.equal(matrix.dates.restOfMonthFrom, dayThree);
  assert.equal(matrix.dates.restOfMonthTo, endOfMonthIso(today));

  const morning = matrix.rows.find((row) => row.campSlot === 'Morning');
  const noon = matrix.rows.find((row) => row.campSlot === 'Noon');
  const evening = matrix.rows.find((row) => row.campSlot === 'Evening');

  assert.equal(morning.today, 1);
  assert.equal(morning.tomorrow, 0);
  assert.equal(morning.dayAfter, 1);
  // EOM = Day 3+ only (laterThisMonth); Day 2 is not in EOM
  assert.equal(morning.restOfMonth, 1);

  assert.equal(noon.today, 1);
  assert.equal(noon.restOfMonth, 0);

  assert.equal(evening.tomorrow, 1);
  assert.equal(evening.restOfMonth, 0);

  assert.equal(matrix.totals.today, 2);
  assert.equal(matrix.totals.tomorrow, 1);
  assert.equal(matrix.totals.dayAfter, 1);
  assert.equal(matrix.totals.restOfMonth, 1);
});

test('Day 2 spill into next month counts in Day 2 but not EOM', () => {
  const now = new Date(2026, 10, 29); // 29 Nov 2026
  const today = toLocalDateIso(now);
  const dayAfter = addLocalDaysIso(today, 2); // 1 Dec
  assert.equal(dayAfter, '2026-12-01');

  const matrix = buildCampScheduleMatrix(
    [
      approvedAssignment({
        campId: 'C9',
        campDate: dayAfter,
        campSlot: 'Morning',
      }),
    ],
    now,
  );
  const morning = matrix.rows.find((row) => row.campSlot === 'Morning');
  assert.equal(morning.dayAfter, 1);
  assert.equal(morning.restOfMonth, 0);
  assert.equal(matrix.totals.restOfMonth, 0);
});
