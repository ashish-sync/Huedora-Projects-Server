import test from 'node:test';
import assert from 'node:assert/strict';
import { campAmountForAssignedHcw, findEmbeddedProviderEmployee } from './campPayoutPayee.js';
import { normalizeProviderEmployees } from './contact.constants.js';

test('normalizeProviderEmployees keeps per-employee campAmount', () => {
  const rows = normalizeProviderEmployees(
    [
      { name: 'Karan', mobile: '9111000001', profession: 'Nurse', campAmount: '1800' },
      { name: 'Neha', mobile: '9111000002', profession: 'Doctor' },
    ],
    'Healthcare Worker',
    'Service Provider',
  );
  assert.equal(rows[0].campAmount, 1800);
  assert.equal(rows[1].campAmount, 0);
});

test('campAmountForAssignedHcw uses the assigned employee rate', () => {
  const provider = {
    _id: 'sp1',
    contactCategory: 'Healthcare Worker',
    resourceType: 'Service Provider',
    campAmount: 9000,
    providerEmployees: [
      { id: 'e1', name: 'Karan', mobile: '9111000001', campAmount: 1500 },
      { id: 'e2', name: 'Neha', mobile: '9111000002', campAmount: 2750 },
    ],
  };
  assert.equal(
    campAmountForAssignedHcw({
      assignmentId: 'spe:sp1:e2',
      payeeContact: provider,
    }),
    2750,
  );
  const emp = findEmbeddedProviderEmployee(provider, 'spe:sp1:e1');
  assert.equal(emp?.name, 'Karan');
});
