import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMasterBillingGstin,
  buildClientMasterBusinessKeyFilter,
  seedMasterBillingFromCompany,
  buildLegacyEmptyGstinMatchFilter,
} from './clientMaster.businessKey.js';
import { assignPreservingExisting } from '../../store/dataIntegrity.js';

test('normalizeMasterBillingGstin trims and uppercases', () => {
  assert.equal(normalizeMasterBillingGstin(' 27aabcu9603r1zm '), '27AABCU9603R1ZM');
  assert.equal(normalizeMasterBillingGstin(null), '');
  assert.equal(normalizeMasterBillingGstin(undefined), '');
});

test('business key filter includes Client + GSTIN + Division + Method', () => {
  const filter = buildClientMasterBusinessKeyFilter({
    clientId: 'abc123',
    billingGstin: ' 27aabcu9603r1zm ',
    programName: ' Cardiology ',
    campName: 'bmd',
  });
  assert.deepEqual(filter, {
    isDeleted: false,
    clientId: 'abc123',
    billingGstin: '27AABCU9603R1ZM',
    programName: 'Cardiology',
    campName: 'BMD',
  });
});

test('business key filter excludes current id on update', () => {
  const filter = buildClientMasterBusinessKeyFilter({
    clientId: 'c1',
    billingGstin: 'GSTIN1',
    programName: 'Div A',
    campName: 'BMD',
    excludeId: 'row-9',
  });
  assert.deepEqual(filter._id, { $ne: 'row-9' });
});

test('different GSTIN yields a different business key', () => {
  const a = buildClientMasterBusinessKeyFilter({
    clientId: 'c1',
    billingGstin: 'GSTIN-A',
    programName: 'Div',
    campName: 'BMD',
  });
  const b = buildClientMasterBusinessKeyFilter({
    clientId: 'c1',
    billingGstin: 'GSTIN-B',
    programName: 'Div',
    campName: 'BMD',
  });
  assert.notEqual(a.billingGstin, b.billingGstin);
  assert.equal(a.clientId, b.clientId);
  assert.equal(a.programName, b.programName);
  assert.equal(a.campName, b.campName);
});

test('different Division or Method yields a different business key', () => {
  const base = {
    clientId: 'c1',
    billingGstin: 'GSTIN1',
    programName: 'Div A',
    campName: 'BMD',
  };
  const byDivision = buildClientMasterBusinessKeyFilter({ ...base, programName: 'Div B' });
  const byMethod = buildClientMasterBusinessKeyFilter({ ...base, campName: 'Tele' });
  assert.notEqual(byDivision.programName, base.programName);
  assert.notEqual(byMethod.campName, 'BMD');
});

test('seedMasterBillingFromCompany fills empty row fields only', () => {
  const row = {
    billingGstin: '',
    billingPan: 'KEEPME1234A',
    billingAddress: '',
    billingStateName: 'Maharashtra',
    billingStateCode: '',
  };
  const client = {
    gstin: '27AABCU9603R1ZM',
    pan: 'AABCU9603R',
    address: 'Pune HQ',
    stateName: 'Ignored',
    stateCode: '27',
  };
  assert.equal(seedMasterBillingFromCompany(row, client), true);
  assert.equal(row.billingGstin, '27AABCU9603R1ZM');
  assert.equal(row.billingPan, 'KEEPME1234A');
  assert.equal(row.billingAddress, 'Pune HQ');
  assert.equal(row.billingStateName, 'Maharashtra');
  assert.equal(row.billingStateCode, '27');
});

test('seedMasterBillingFromCompany is a no-op when row already has billing', () => {
  const row = {
    billingGstin: '27AAAAA0000A1Z5',
    billingPan: 'AAAAA0000A',
    billingAddress: 'Row address',
    billingStateName: 'Goa',
    billingStateCode: '30',
  };
  const client = {
    gstin: '27AABCU9603R1ZM',
    pan: 'AABCU9603R',
    address: 'Company',
    stateName: 'MH',
    stateCode: '27',
  };
  assert.equal(seedMasterBillingFromCompany(row, client), false);
  assert.equal(row.billingGstin, '27AAAAA0000A1Z5');
  assert.equal(row.billingAddress, 'Row address');
});

test('updating one row billing must not mutate another via assignPreservingExisting', () => {
  const rowA = {
    billingGstin: 'GSTIN-A',
    billingAddress: 'Addr A',
    spocName: 'Alice',
  };
  const rowB = {
    billingGstin: 'GSTIN-B',
    billingAddress: 'Addr B',
    spocName: 'Bob',
  };
  assignPreservingExisting(rowA, {
    billingGstin: 'GSTIN-A-NEW',
    billingAddress: 'Addr A New',
    spocName: 'Alice Updated',
  });
  assert.equal(rowA.billingGstin, 'GSTIN-A-NEW');
  assert.equal(rowA.billingAddress, 'Addr A New');
  assert.equal(rowB.billingGstin, 'GSTIN-B');
  assert.equal(rowB.billingAddress, 'Addr B');
  assert.equal(rowB.spocName, 'Bob');
});

test('legacy empty-GSTIN match filter targets Client + Division + Method only', () => {
  const filter = buildLegacyEmptyGstinMatchFilter({
    clientId: 'c1',
    programName: 'Div',
    campName: 'BMD',
  });
  assert.equal(filter.clientId, 'c1');
  assert.equal(filter.programName, 'Div');
  assert.equal(filter.campName, 'BMD');
  assert.ok(Array.isArray(filter.$or));
  assert.ok(filter.$or.some((part) => part.billingGstin === ''));
});
