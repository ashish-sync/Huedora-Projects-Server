import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCampCycleFromWorkingHours,
  elapsedCampCycleWorkingHours,
  istWallClockToUtcMs,
  resolveCampEndInstant,
} from './campCycleWorkingHours.js';

test('istWallClockToUtcMs maps IST noon to 06:30 UTC', () => {
  const ms = istWallClockToUtcMs(2026, 11, 10, 12, 0);
  assert.equal(new Date(ms).toISOString(), '2026-11-10T06:30:00.000Z');
});

test('resolveCampEndInstant prefers outTime over endTime', () => {
  const end = resolveCampEndInstant({
    campDate: '2026-11-10',
    endTime: '12:00',
    outTime: '15:30',
  });
  assert.equal(end.toISOString(), '2026-11-10T10:00:00.000Z'); // 15:30 IST
});

test('elapsedCampCycleWorkingHours skips Sunday and nights', () => {
  // Sat 18:00 IST → Mon 11:00 IST = 1h Sat + 1h Mon = 2h
  const start = istWallClockToUtcMs(2026, 11, 14, 18, 0); // Saturday
  const end = istWallClockToUtcMs(2026, 11, 16, 11, 0); // Monday
  assert.equal(elapsedCampCycleWorkingHours(start, end), 2);
});

test('classifyCampCycleFromWorkingHours buckets thresholds', () => {
  assert.equal(classifyCampCycleFromWorkingHours({}, { cancelled: true }), 'Cancelled');
  assert.equal(classifyCampCycleFromWorkingHours({
    campDate: '2026-11-10',
    outTime: '12:00',
  }), 'Pending');

  const base = {
    campDate: '2026-11-10', // Tuesday
    outTime: '10:00',
  };
  // Tue 10:00 → Wed 17:00 = 9h + 7h = 16h → Good
  assert.equal(classifyCampCycleFromWorkingHours({
    ...base,
    paymentConfirmedAt: new Date(istWallClockToUtcMs(2026, 11, 11, 17, 0)).toISOString(),
  }), 'Good');
  // Tue 10:00 → Thu 14:00 = 9h + 9h + 4h = 22h → Average
  assert.equal(classifyCampCycleFromWorkingHours({
    ...base,
    paymentConfirmedAt: new Date(istWallClockToUtcMs(2026, 11, 12, 14, 0)).toISOString(),
  }), 'Average');
  // Tue 10:00 → next week → Poor
  assert.equal(classifyCampCycleFromWorkingHours({
    ...base,
    paymentConfirmedAt: new Date(istWallClockToUtcMs(2026, 11, 17, 12, 0)).toISOString(),
  }), 'Poor');
});
