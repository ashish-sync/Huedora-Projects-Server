import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADVANCE_BOOKING_WORKING_MS,
  REQUEST_ACCEPTANCE_WINDOW_ERROR,
  elapsedAdvanceBookingWorkingMs,
  getAdvanceBookingEligibility,
  getAdvanceBookingErrors,
  hasMinimumAdvanceBookingLeadTime,
  istWallToUtcMs,
  isWithinRequestAcceptanceWindow,
  minCampDateIsoSatisfyingAdvanceBooking,
  parseCampStartDateTime,
} from './campAdvanceBooking.js';

/** Build a Date for an IST wall-clock moment. */
function istDate(year, monthIndex, day, hour, minute = 0) {
  return new Date(istWallToUtcMs({
    year,
    month: monthIndex,
    day,
    hour,
    minute,
  }));
}

describe('campAdvanceBooking', () => {
  it('identifies working-hour acceptance window (informational only)', () => {
    assert.equal(isWithinRequestAcceptanceWindow(istDate(2026, 2, 18, 10, 0)), true);
    assert.equal(isWithinRequestAcceptanceWindow(istDate(2026, 2, 18, 19, 0)), false);
    assert.equal(isWithinRequestAcceptanceWindow(istDate(2026, 2, 15, 12, 0)), false);
  });

  it('allows submission outside working hours — only lead time is gated', () => {
    // Sunday noon IST submission → Monday 10:00 camp (0 working hours) → reject lead time
    const sunday = istDate(2026, 2, 15, 12, 0);
    const sundayErrors = getAdvanceBookingErrors(
      { campDate: '2026-03-16', startTime: '10:00' },
      sunday,
    );
    assert.equal(sundayErrors.some((e) => e.includes(REQUEST_ACCEPTANCE_WINDOW_ERROR)), false);
    assert.ok(sundayErrors.length > 0);

    // Sunday noon → Wednesday 12:00
    // Mon 9h + Tue 9h + Wed 2h = 20h ≥ 18
    assert.deepEqual(
      getAdvanceBookingErrors({ campDate: '2026-03-18', startTime: '12:00' }, sunday),
      [],
    );
  });

  it('counts only Mon–Sat 10–19 IST working hours and resumes after gaps', () => {
    // Fri 18:00 → Mon 11:00 IST = 1h Fri + 9h Sat + 1h Mon = 11h
    const start = istDate(2026, 2, 20, 18, 0);
    const end = istDate(2026, 2, 23, 11, 0);
    assert.equal(elapsedAdvanceBookingWorkingMs(start, end), 11 * 60 * 60 * 1000);

    // After hours Fri 20:00 → Sat 11:00 = Sat 10–11 only = 1h
    const afterHours = istDate(2026, 2, 20, 20, 0);
    const satMorning = istDate(2026, 2, 21, 11, 0);
    assert.equal(elapsedAdvanceBookingWorkingMs(afterHours, satMorning), 1 * 60 * 60 * 1000);
  });

  it('requires ≥ 18 working hours and allows exactly 18', () => {
    const now = istDate(2026, 2, 18, 11, 0); // Wed 11:00 IST
    assert.ok(
      getAdvanceBookingErrors({ campDate: '2026-03-18', startTime: '18:00' }, now).length > 0,
    );

    // Wed 11 → Fri 11: Wed 8 + Thu 9 + Fri 1 = 18 exactly
    assert.deepEqual(
      getAdvanceBookingErrors({ campDate: '2026-03-20', startTime: '11:00' }, now),
      [],
    );
    assert.ok(
      elapsedAdvanceBookingWorkingMs(now, parseCampStartDateTime('2026-03-20', '11:00'))
        >= ADVANCE_BOOKING_WORKING_MS,
    );
  });

  it('handles Saturday submissions and multi-week lead time', () => {
    // Saturday 16:00 IST → next Tuesday 12:00
    // Sat 16–19 = 3h, Sun 0, Mon 9h, Tue 10–12 = 2h → 14h (short)
    const saturday = istDate(2026, 2, 21, 16, 0);
    assert.ok(
      getAdvanceBookingErrors({ campDate: '2026-03-24', startTime: '12:00' }, saturday).length > 0,
    );

    // Saturday 16:00 → next Wednesday 12:00
    // Sat 3 + Mon 9 + Tue 9 + Wed 2 = 23h ≥ 18
    assert.deepEqual(
      getAdvanceBookingErrors({ campDate: '2026-03-25', startTime: '12:00' }, saturday),
      [],
    );

    // Multi-week: Friday after hours → camp two weeks later Monday 10:00
    const friNight = istDate(2026, 2, 20, 21, 0);
    assert.equal(
      hasMinimumAdvanceBookingLeadTime(parseCampStartDateTime('2026-03-30', '10:00'), friNight),
      true,
    );
  });

  it('exposes eligibility summary for UI', () => {
    const now = istDate(2026, 2, 18, 11, 0);
    const short = getAdvanceBookingEligibility(
      { campDate: '2026-03-18', startTime: '18:00' },
      now,
    );
    assert.equal(short.ok, false);
    assert.equal(short.ready, true);
    assert.match(short.message, /Insufficient advance notice/i);

    const ok = getAdvanceBookingEligibility(
      { campDate: '2026-03-20', startTime: '12:00' },
      now,
    );
    assert.equal(ok.ok, true);
    assert.match(ok.message, /Advance notice met/i);
  });

  it('computes earliest selectable camp date for the date picker', () => {
    const now = istDate(2026, 2, 18, 11, 0);
    assert.equal(minCampDateIsoSatisfyingAdvanceBooking(now, '11:00'), '2026-03-20');
  });
});
