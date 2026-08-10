import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCampClosure } from './campOps.closure.js';

function baseCamp(overrides = {}) {
  return {
    status: 'approved',
    lifecycleStage: 'execution',
    chargeableStatus: '',
    assignmentStatus: 'Assigned',
    hcwContactId: 'c1',
    hcwCategory: 'Technician',
    hcwName: 'A',
    hcwContact: '999',
    ...overrides,
  };
}

test('execution cancel requires Chargeable Status', () => {
  const camp = baseCamp();
  assert.throws(
    () => applyCampClosure(camp, {
      closureType: 'Cancelled by Client',
      reasonCategory: 'Client Decision',
      subReason: 'client_cancelled',
    }),
    /Select Chargeable Status/,
  );
});

test('execution cancel updates Chargeable Status', () => {
  const camp = baseCamp({ chargeableStatus: 'Chargeable' });
  applyCampClosure(camp, {
    closureType: 'Cancelled by Tylo',
    reasonCategory: 'Resource Issue',
    subReason: 'hcw_unavailability',
    chargeableStatus: 'Non-Chargeable',
  });
  assert.equal(camp.status, 'cancelled');
  assert.equal(camp.chargeableStatus, 'Non-Chargeable');
  assert.equal(camp.assignmentRefusalReason, 'Cancelled by Tylo');
});

test('assignment close does not require Chargeable Status', () => {
  const camp = baseCamp({
    lifecycleStage: 'assignment',
    chargeableStatus: '',
  });
  applyCampClosure(camp, {
    closureType: 'Refused',
    reasonCategory: 'Request Issue',
    subReason: 'duplicate_request',
  });
  assert.equal(camp.status, 'rejected');
  assert.equal(camp.chargeableStatus, '');
});
