import assert from 'node:assert/strict';
import {
  canSetHistoricalCampDates,
  daysFromToday,
  getHistoricalCampDateErrors,
  isHistoricalCampDate,
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

test('admin role without team leader designation cannot set historical dates', () => {
  const adminUser = { designation: 'Administrator' };
  assert.equal(canSetHistoricalCampDates(adminUser), false);
  const errors = getHistoricalCampDateErrors(
    { campDate: iso(-5) },
    { canSetHistorical: canSetHistoricalCampDates(adminUser) },
  );
  assert.equal(errors.length, 1);
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
