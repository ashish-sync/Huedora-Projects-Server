import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferAccessProfile, TEAM_ACCESS_PROFILES } from './teamAccessProfiles.js';

test('inferAccessProfile maps spreadsheet columns', () => {
  assert.equal(
    inferAccessProfile({ edit: 'All Modules', approve: 'All Modules' }),
    'full_access'
  );
  assert.equal(
    inferAccessProfile({
      edit: 'Camp One, Document One, Request One',
      approve: 'NA',
    }),
    'camp_coordinator'
  );
  assert.equal(
    inferAccessProfile({ edit: 'Movement One', approve: 'Movement One' }),
    'logistics_associate'
  );
  assert.equal(inferAccessProfile({ accessProfile: 'full_access' }), 'full_access');
});

test('team access profiles map to standard roles', () => {
  assert.equal(Object.keys(TEAM_ACCESS_PROFILES).length, 3);
  assert.deepEqual(TEAM_ACCESS_PROFILES.full_access.roleNames, ['Editor', 'Approver']);
  assert.deepEqual(TEAM_ACCESS_PROFILES.camp_coordinator.roleNames, ['Camp Coordinator']);
  assert.deepEqual(TEAM_ACCESS_PROFILES.logistics_associate.roleNames, ['Editor', 'Approver']);
});
