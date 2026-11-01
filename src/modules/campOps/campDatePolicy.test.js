import assert from 'node:assert/strict';
import {
  campCreateApprovalReasons,
  canSetHistoricalCampDates,
  daysFromToday,
  getFutureRequestDateError,
  getHistoricalCampDateErrors,
  isFutureRequestDate,
  isHistoricalCampDate,
  isT2RequestDate,
  isT2UpcomingCampDate,
  isTeamLeaderDesignation,
} from './campDatePolicy.js';

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

const today = new Date();
today.setHours(0, 0, 0, 0);
const iso = (offsetDays) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

test('team leader designation is recognized', () => {
  assert.equal(isTeamLeaderDesignation('Team Leader'), true);
  assert.equal(isTeamLeaderDesignation('Healthcare Camp Coordinator'), false);
});

test('historical camp date is more than 2 days before today', () => {
  assert.equal(isHistoricalCampDate(iso(-3)), true);
  assert.equal(isHistoricalCampDate(iso(-2)), false);
  assert.equal(isHistoricalCampDate(iso(5)), false);
});

test('anyone can enter historical dates; RM approval is the gate', () => {
  const errors = getHistoricalCampDateErrors(
    { campDate: iso(-5), requestDate: iso(-4) },
    { canSetHistorical: false },
  );
  assert.equal(errors.length, 0);
  assert.equal(canSetHistoricalCampDates({ designation: 'Team Leader' }), true);
  assert.equal(canSetHistoricalCampDates({ designation: 'Administrator' }), true);
  const user = { designation: 'Healthcare Camp Coordinator' };
  assert.equal(canSetHistoricalCampDates(user, new Set(['*'])), true);
});

test('T-2 request date is yesterday or the day before, not today', () => {
  assert.equal(isT2RequestDate(iso(0)), false);
  assert.equal(isT2RequestDate(iso(-1)), true);
  assert.equal(isT2RequestDate(iso(-2)), true);
  assert.equal(isT2RequestDate(iso(-3)), false);
});

test('T-2 upcoming camp date is today through +2 days', () => {
  assert.equal(isT2UpcomingCampDate(iso(0)), true);
  assert.equal(isT2UpcomingCampDate(iso(2)), true);
  assert.equal(isT2UpcomingCampDate(iso(3)), false);
  assert.equal(isT2UpcomingCampDate(iso(-1)), false);
});

test('routine camp create does not need RM approval', () => {
  assert.deepEqual(campCreateApprovalReasons({ campDate: iso(10), requestDate: iso(0) }), []);
  assert.deepEqual(campCreateApprovalReasons({ campDate: iso(1), requestDate: iso(-2) }), []);
});

test('request or camp dates earlier than today minus 2 days need RM approval', () => {
  const oldCamp = campCreateApprovalReasons({ campDate: iso(-3), requestDate: iso(0) });
  assert.ok(oldCamp.includes('camp_date_historical'));
  const oldRequest = campCreateApprovalReasons({ campDate: iso(10), requestDate: iso(-3) });
  assert.ok(oldRequest.includes('request_date_historical'));
});

test('request date cannot be in the future', () => {
  assert.equal(isFutureRequestDate(iso(0)), false);
  assert.equal(isFutureRequestDate(iso(-1)), false);
  assert.equal(isFutureRequestDate(iso(1)), true);
  assert.match(getFutureRequestDateError(iso(2)), /cannot be in the future/i);
});

test('unchanged historical dates on edit are allowed for non-leaders', () => {
  const errors = getHistoricalCampDateErrors(
    { campDate: iso(-10) },
    { canSetHistorical: false, existing: { campDate: iso(-10) } },
  );
  assert.equal(errors.length, 0);
});

if (!process.exitCode) {
  console.log(`\nAll camp date policy tests passed (${daysFromToday(iso(0))} days offset for today).`);
}
