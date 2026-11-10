import assert from 'node:assert/strict';
import {
  canUsePipelineAdminFilters,
  buildCampPipelineFilter,
} from './campPipeline.js';

assert.equal(canUsePipelineAdminFilters({ systemRole: 'Super Admin' }), true);
assert.equal(canUsePipelineAdminFilters({ systemRole: 'Admin' }), true);
assert.equal(canUsePipelineAdminFilters({ systemRole: 'User' }), false);
assert.equal(canUsePipelineAdminFilters({}), false);

{
  const { filter, applied } = await buildCampPipelineFilter(
    {
      dateFrom: '2026-11-01',
      dateTo: '2026-11-30',
      campaign: 'BMD',
      assignedUser: 'ops@tylo.test',
    },
    { systemRole: 'User' }
  );
  assert.equal(applied.adminFilters, false);
  assert.equal(applied.campaign, null);
  assert.equal(applied.assignedUser, null);
  assert.equal(applied.programScoped, false);
  assert.equal(filter.campaignName, undefined);
  assert.ok(filter.campDate?.$gte);
  assert.ok(filter.campDate?.$lte);
}

{
  const { filter, applied } = await buildCampPipelineFilter(
    {
      dateFrom: '2026-11-01',
      dateTo: '2026-11-30',
      campaign: 'BMD',
    },
    { systemRole: 'Admin' }
  );
  assert.equal(applied.adminFilters, true);
  assert.equal(applied.campaign, 'BMD');
  assert.equal(filter.campaignName, 'BMD');
}

console.log('campPipeline.test.js: ok');
