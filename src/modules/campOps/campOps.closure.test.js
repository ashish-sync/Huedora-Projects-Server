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
  assert.equal(camp.executionStatus, 'Cancelled by Tylo');
  assert.equal(camp.lifecycleStage, 'financial');
  assert.equal(camp.hcwContactId, null);
  assert.equal(camp.assignmentStatus, 'Unassigned');
});

test('execution cancel by client advances to financial stage', () => {
  const camp = baseCamp({ chargeableStatus: 'Chargeable' });
  applyCampClosure(camp, {
    closureType: 'Cancelled by Client',
    reasonCategory: 'Client Decision',
    subReason: 'client_cancelled',
    chargeableStatus: 'Non-Chargeable',
  });
  assert.equal(camp.status, 'cancelled');
  assert.equal(camp.executionStatus, 'Cancelled by Client');
  assert.equal(camp.lifecycleStage, 'financial');
  assert.equal(camp.cancelledBy, 'brand');
});

test('assignment cancel by tylo is rejected (cancellation is Execution-only)', () => {
  const camp = baseCamp({
    lifecycleStage: 'assignment',
    chargeableStatus: '',
  });
  assert.throws(
    () => applyCampClosure(camp, {
      closureType: 'Cancelled by Tylo',
      reasonCategory: 'Resource Issue',
      subReason: 'hcw_unavailability',
    }),
    /Only Refused is allowed at the assignment stage/,
  );
});

test('assignment refuse moves to Request / Refused without Chargeable Status', () => {
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
  assert.equal(camp.lifecycleStage, 'request');
  assert.equal(camp.requestReviewStatus, 'request_rejected');
  assert.equal(camp.chargeableStatus, '');
  assert.notEqual(camp.lifecycleStage, 'financial');
});
