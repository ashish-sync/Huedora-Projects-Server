import assert from 'node:assert/strict';
import {
  campCreateApprovalReasons,
  canSetHistoricalCampDates,
  daysFromToday,
  getHistoricalCampDateErrors,
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

test('non-leaders cannot set historical dates', () => {
  const errors = getHistoricalCampDateErrors(
    { campDate: iso(-5), requestDate: iso(-4) },
    { canSetHistorical: false },
  );
  assert.equal(errors.length, 2);
});

test('team leaders can set historical dates', () => {
  const user = { designation: 'Team Leader' };
  assert.equal(canSetHistoricalCampDates(user), true);
  const errors = getHistoricalCampDateErrors(
    { campDate: iso(-10) },
    { canSetHistorical: canSetHistoricalCampDates(user) },
  );
  assert.equal(errors.length, 0);
});

test('admin designation can set historical dates', () => {
  const adminUser = { designation: 'Administrator' };
  assert.equal(canSetHistoricalCampDates(adminUser), true);
  const errors = getHistoricalCampDateErrors(
    { campDate: iso(-5) },
    { canSetHistorical: canSetHistoricalCampDates(adminUser) },
  );
  assert.equal(errors.length, 0);
});

test('admin permission * can set historical dates', () => {
  const user = { designation: 'Healthcare Camp Coordinator' };
  const permissions = new Set(['*']);
  assert.equal(canSetHistoricalCampDates(user, permissions), true);
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
});

test('short-notice camp date or backdated request needs RM approval', () => {
  const soon = campCreateApprovalReasons({ campDate: iso(1), requestDate: iso(0) });
  assert.ok(soon.includes('camp_date_t2'));
  const late = campCreateApprovalReasons({ campDate: iso(10), requestDate: iso(-2) });
  assert.ok(late.includes('request_date_t2'));
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
