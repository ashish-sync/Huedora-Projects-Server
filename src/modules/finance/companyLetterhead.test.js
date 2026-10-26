import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCompanyLetterhead, sanitizeHeaderDisplayKeys } from './companyLetterhead.js';

const org = {
  legalName: 'Tylo Care Private Limited',
  registeredOffice: 'Mumbai',
  gstin: '27AANCT2428H1Z4',
  cin: 'U86909MH2026PTC472417',
  udyam: 'UDYAM-MH-19-0446179',
  email: 'growth@tylocare.com',
  website: 'tylocare.com',
};

test('letterhead defaults include GSTIN CIN Udyam Email Website', () => {
  const letterhead = formatCompanyLetterhead(org);
  assert.match(letterhead.line2, /GSTIN:/);
  assert.match(letterhead.line2, /CIN:/);
  assert.match(letterhead.line2, /Udyam:/);
  assert.match(letterhead.line2, /Email:/);
  assert.match(letterhead.line2, /Website:/);
});

test('letterhead respects picked header fields', () => {
  const letterhead = formatCompanyLetterhead({
    ...org,
    headerDisplayKeys: ['gstin', 'website'],
  });
  assert.deepEqual(letterhead.metaParts, [
    'GSTIN: 27AANCT2428H1Z4',
    'Website: tylocare.com',
  ]);
});

test('empty header picks omit line 2', () => {
  assert.deepEqual(sanitizeHeaderDisplayKeys([]), []);
  const letterhead = formatCompanyLetterhead({ ...org, headerDisplayKeys: [] });
  assert.equal(letterhead.line2, '');
});
