import test from 'node:test';
import assert from 'node:assert/strict';
import {
  custodyRequiresCustodianContact,
  contactMatchesCustody,
  custodyContactTypeError,
} from './device.constants.js';

test('Individual and Service Provider custody require a directory contact', () => {
  assert.equal(custodyRequiresCustodianContact('Individual'), true);
  assert.equal(custodyRequiresCustodianContact('Service Provider'), true);
  assert.equal(custodyRequiresCustodianContact('Tylo Office'), false);
  assert.equal(custodyRequiresCustodianContact('Client / Rented'), false);
  assert.equal(custodyRequiresCustodianContact(''), false);
});

test('contactMatchesCustody accepts any Healthcare Worker for Individual or Service Provider custody', () => {
  const individual = {
    contactCategory: 'Healthcare Worker',
    resourceType: 'Individual',
  };
  const serviceProvider = {
    contactCategory: 'Healthcare Worker',
    resourceType: 'Service Provider',
  };
  const fullTime = {
    contactCategory: 'Healthcare Worker',
    resourceType: 'Full-Time',
  };
  const other = {
    contactCategory: 'Healthcare Worker',
    resourceType: 'Other',
  };
  const client = { contactCategory: 'Client', resourceType: '' };

  assert.equal(contactMatchesCustody(individual, 'Individual'), true);
  assert.equal(contactMatchesCustody(serviceProvider, 'Service Provider'), true);
  assert.equal(contactMatchesCustody(serviceProvider, 'Individual'), true);
  assert.equal(contactMatchesCustody(individual, 'Service Provider'), true);
  assert.equal(contactMatchesCustody(fullTime, 'Individual'), true);
  assert.equal(contactMatchesCustody(other, 'Service Provider'), true);
  assert.equal(contactMatchesCustody(client, 'Individual'), false);
  assert.equal(contactMatchesCustody(individual, 'Tylo Office'), true);
  assert.equal(contactMatchesCustody(null, 'Individual'), false);
  assert.match(custodyContactTypeError('Individual'), /Healthcare Worker/);
  assert.match(custodyContactTypeError('Service Provider'), /Healthcare Worker/);
});
