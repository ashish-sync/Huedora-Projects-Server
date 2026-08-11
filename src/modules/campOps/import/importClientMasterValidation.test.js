import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyClientMasterValidationToResult,
  getClientMasterImportErrors,
} from './importClientMasterValidation.js';

function buildCatalog() {
  const client = { id: 'client-1', name: 'Acme Pharma' };
  const masters = [
    {
      clientId: 'client-1',
      clientName: 'Acme Pharma',
      programName: 'Cardio',
      campName: 'BMD',
      isActive: true,
    },
    {
      clientId: 'client-1',
      clientName: 'Acme Pharma',
      programName: 'Women Health',
      campName: 'Vitamin D',
      isActive: true,
    },
  ];

  return {
    clientsByName: new Map([['acme pharma', client]]),
    mastersByClientId: new Map([['client-1', masters]]),
    mastersByClientName: new Map([['acme pharma', masters]]),
  };
}

test('blocks unknown client name', () => {
  const errors = getClientMasterImportErrors({
    clientName: 'UNS-2',
    campaignType: 'Women Health',
    campaignName: 'Vitamin D3',
  }, buildCatalog());
  assert.match(errors.join(' '), /UNS-2/);
});

test('blocks unknown division for known client', () => {
  const errors = getClientMasterImportErrors({
    clientName: 'Acme Pharma',
    campaignType: 'Women Health',
    campaignName: 'Vitamin D3',
  }, buildCatalog());
  assert.match(errors.join(' '), /Method "Vitamin D3"/);
  assert.match(errors.join(' '), /Vitamin D/);
});

test('accepts exact client master division and method', () => {
  const errors = getClientMasterImportErrors({
    clientName: 'Acme Pharma',
    campaignType: 'Cardio',
    campaignName: 'BMD',
  }, buildCatalog());
  assert.equal(errors.length, 0);
});

test('moves valid rows with client master mismatch to invalidRows', () => {
  const catalog = buildCatalog();
  const result = applyClientMasterValidationToResult({
    validRows: [{
      clientName: 'Acme Pharma',
      campaignType: 'Women Health',
      campaignName: 'Vitamin D3',
    }],
    invalidRows: [],
    partialRows: [],
  }, catalog);

  assert.equal(result.validRows.length, 0);
  assert.equal(result.invalidRows.length, 1);
  assert.match(result.invalidRows[0].errors.join(' '), /Vitamin D3/);
});
