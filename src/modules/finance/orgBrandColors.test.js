import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  resolveOrgBrandColors,
  sanitizeBrandColor,
} from './orgBrandColors.js';
import { attachOrgBrand, brandOf, BRAND } from './pdfBrand.js';

test('sanitizeBrandColor normalizes hex and rejects invalid values', () => {
  assert.equal(sanitizeBrandColor('#203e64'), '#203E64');
  assert.equal(sanitizeBrandColor('E7EDF4'), '#E7EDF4');
  assert.equal(sanitizeBrandColor('navy'), null);
});

test('resolveOrgBrandColors uses Tylo Care defaults when unset', () => {
  assert.deepEqual(resolveOrgBrandColors({}), {
    primary: DEFAULT_PRIMARY_COLOR,
    secondary: DEFAULT_SECONDARY_COLOR,
  });
});

test('attachOrgBrand paints PDF palette from the organisation', () => {
  const pdf = {};
  attachOrgBrand(pdf, { primaryColor: '#112233', secondaryColor: '#abcdef' });
  assert.equal(brandOf(pdf).royal, '#112233');
  assert.equal(brandOf(pdf).royalLight, '#ABCDEF');
  assert.equal(brandOf({}).royal, BRAND.royal);
});
