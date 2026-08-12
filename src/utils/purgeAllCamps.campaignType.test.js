import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countCampsByCampaignTypes,
  normalizeCampaignTypesInput,
  parseCampaignTypesEnv,
  purgeCampsByCampaignTypes,
} from './purgeAllCamps.js';

test('parseCampaignTypesEnv splits comma/pipe lists', () => {
  assert.deepEqual(parseCampaignTypesEnv('MOM'), ['MOM']);
  assert.deepEqual(parseCampaignTypesEnv(' MOM , Oncology '), ['MOM', 'Oncology']);
  assert.deepEqual(parseCampaignTypesEnv('MOM|Cardio'), ['MOM', 'Cardio']);
  assert.deepEqual(parseCampaignTypesEnv(''), []);
  assert.deepEqual(parseCampaignTypesEnv('false'), ['false']);
});

test('normalizeCampaignTypesInput accepts string or array', () => {
  assert.deepEqual(normalizeCampaignTypesInput('MOM'), ['MOM']);
  assert.deepEqual(normalizeCampaignTypesInput(['MOM', ' mom ', '']), ['MOM']);
});

test('purgeCampsByCampaignTypes returns empty for blank types', async () => {
  const result = await purgeCampsByCampaignTypes(['', '  '], { actorId: 'test' });
  assert.equal(result.purged, 0);
  assert.equal(result.matched, 0);
  assert.deepEqual(result.campaignTypes, []);
});

test('countCampsByCampaignTypes returns empty for blank types', async () => {
  const result = await countCampsByCampaignTypes([]);
  assert.equal(result.total, 0);
  assert.deepEqual(result.byCampaignType, {});
});
