import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContactPayload } from './contact.model.js';
import { assignPreservingExisting } from '../../store/dataIntegrity.js';

test('normalizeContactPayload omits providerEmployees when not sent (no silent wipe)', () => {
  const payload = normalizeContactPayload({
    name: 'Agency',
    contactCategory: 'Healthcare Worker',
    resourceType: 'Service Provider',
    contact: '9876543210',
    state: 'Maharashtra',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'providerEmployees'), false);
});

test('normalizeContactPayload keeps explicit employee roster for Service Provider', () => {
  const payload = normalizeContactPayload({
    name: 'Agency',
    contactCategory: 'Healthcare Worker',
    resourceType: 'Service Provider',
    contact: '9876543210',
    state: 'Maharashtra',
    providerEmployees: [{ name: 'Ravi', mobile: '9123456789', profession: 'Technician' }],
  });
  assert.equal(payload.providerEmployees.length, 1);
  assert.equal(payload.providerEmployees[0].name, 'Ravi');
});

test('PATCH merge does not wipe providerEmployees when key omitted', () => {
  const contact = {
    contactCategory: 'Healthcare Worker',
    resourceType: 'Service Provider',
    providerEmployees: [{ id: '1', name: 'Ravi', mobile: '9123456789', profession: '' }],
  };
  const payload = normalizeContactPayload({
    name: 'Agency Updated',
    contactCategory: 'Healthcare Worker',
    resourceType: 'Service Provider',
    contact: '9876543210',
    state: 'Maharashtra',
  });
  assignPreservingExisting(contact, payload);
  assert.equal(contact.providerEmployees.length, 1);
  assert.equal(contact.providerEmployees[0].name, 'Ravi');
  assert.equal(contact.name, 'Agency Updated');
});

test('empty providerEmployees array would wipe if sent — callers must omit instead', () => {
  const contact = {
    providerEmployees: [{ id: '1', name: 'Ravi', mobile: '9123456789', profession: '' }],
  };
  assignPreservingExisting(contact, { providerEmployees: [] });
  assert.deepEqual(contact.providerEmployees, []);
});

test('PATCH blank city/state must not wipe persisted location', () => {
  const contact = {
    name: 'Vendor Co',
    contactCategory: 'Vendor',
    city: 'Pune',
    state: 'Maharashtra',
    stateId: 'st1',
    cityId: 'ct1',
  };
  const payload = normalizeContactPayload({
    name: 'Vendor Co',
    contactCategory: 'Vendor',
    supplyCategory: 'Medical',
    contact: '9876543210',
    city: '',
    state: '',
    stateId: '',
    cityId: '',
  });
  assignPreservingExisting(contact, payload);
  assert.equal(contact.city, 'Pune');
  assert.equal(contact.state, 'Maharashtra');
  assert.equal(contact.stateId, 'st1');
  assert.equal(contact.cityId, 'ct1');
});
