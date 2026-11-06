import test from 'node:test';
import assert from 'node:assert/strict';
import { assignedHcwDetailsFromContacts } from './campAssignedHcwExport.js';

test('export overlay prefers Contact Directory name after Change HCW when camp denormalized fields are stale', () => {
  const contactsById = new Map([
    ['hcw-2', { _id: 'hcw-2', name: 'Anita New', contact: '8888888888' }],
  ]);
  const live = assignedHcwDetailsFromContacts({
    hcwContactId: 'hcw-2',
    hcwName: 'Ravi Old',
    hcwContact: '9999999999',
    hcwCategory: 'Technician',
  }, contactsById);
  assert.equal(live.hcwName, 'Anita New');
  assert.equal(live.hcwContact, '8888888888');
  assert.equal(live.hcwCategory, 'Technician');
});

test('export overlay keeps camp HCW fields when Contact Directory row is missing', () => {
  const live = assignedHcwDetailsFromContacts({
    hcwContactId: 'missing',
    hcwName: 'Ravi',
    hcwContact: '9999999999',
    hcwCategory: 'Technician',
  }, new Map());
  assert.equal(live.hcwName, 'Ravi');
  assert.equal(live.hcwContact, '9999999999');
});

test('export overlay resolves embedded Service Provider roster employees', () => {
  const contactsById = new Map([
    ['prov-1', {
      _id: 'prov-1',
      name: 'Agency',
      contact: '1111111111',
      providerEmployees: [
        { id: 'emp-9', name: 'Roster Anita', mobile: '7777777777' },
      ],
    }],
  ]);
  const live = assignedHcwDetailsFromContacts({
    hcwContactId: 'spe:prov-1:emp-9',
    hcwName: 'Stale Name',
    hcwContact: '0000000000',
    hcwCategory: 'Technician',
  }, contactsById);
  assert.equal(live.hcwName, 'Roster Anita');
  assert.equal(live.hcwContact, '7777777777');
});
