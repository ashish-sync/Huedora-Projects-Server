import test from 'node:test';
import assert from 'node:assert/strict';
import {
  campMatchesCampaignTypeExact,
  filterCampsByCampaignTypeExact,
  normalizeCampaignTypeExact,
} from './campCampaignTypeMatch.js';
import {
  CAMP_CAMPAIGN_TYPE_FIELD,
  CAMP_OPS_COLLECTION,
  MONGO_COLLECTION,
  __testCampMatches,
} from './hardDeleteCampsByCampaignTypeOnBoot.js';

test('normalizeCampaignTypeExact trims and lowercases', () => {
  assert.equal(normalizeCampaignTypeExact(' MOM '), 'mom');
  assert.equal(normalizeCampaignTypeExact('Mom'), 'mom');
  assert.equal(normalizeCampaignTypeExact(''), '');
});

test('exact MOM match — case and whitespace variants', () => {
  const momVariants = ['MOM', 'mom', 'Mom', ' MOM ', '  mom  '];
  for (const value of momVariants) {
    assert.equal(campMatchesCampaignTypeExact({ campaignType: value }, 'MOM'), true, value);
    assert.equal(__testCampMatches({ campaignType: value }, 'MOM'), true, value);
  }
});

test('non-MOM campaign types never match MOM target', () => {
  const nonMom = [
    'MOM Camp',
    'MOM - Special',
    'DIALYSIS',
    'ENT',
    'Oncology',
    'mom camp',
    'MOMCamp',
    'Special MOM',
    '',
    '   ',
  ];
  for (const value of nonMom) {
    assert.equal(
      campMatchesCampaignTypeExact({ campaignType: value }, 'MOM'),
      false,
      `should not match: ${JSON.stringify(value)}`,
    );
  }
});

test('filterCampsByCampaignTypeExact returns only exact matches', () => {
  const camps = [
    { _id: '1', campaignType: 'MOM' },
    { _id: '2', campaignType: 'MOM Camp' },
    { _id: '3', campaignType: ' mom ' },
    { _id: '4', campaignType: 'DIALYSIS' },
  ];
  const matched = filterCampsByCampaignTypeExact(camps, 'MOM');
  assert.deepEqual(matched.map((c) => c._id), ['1', '3']);
});

test('collection and field constants match CampOpsCamp schema', () => {
  assert.equal(CAMP_OPS_COLLECTION, 'camp_ops_camps');
  assert.equal(MONGO_COLLECTION, 'tylo_camp_ops_camps');
  assert.equal(CAMP_CAMPAIGN_TYPE_FIELD, 'campaignType');
});
