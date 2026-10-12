import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS } from '../../config/constants.js';
import {
  assertVendorBillSegregationOfDuties,
  assertVendorBillPaySegregationOfDuties,
  permissionForVendorBillTransition,
} from './vendorBill.sod.js';

test('submitter cannot verify', async () => {
  await assert.rejects(
    () =>
      assertVendorBillSegregationOfDuties(
        { status: 'under_verification', submittedById: 'u1' },
        'verified',
        { _id: 'u1' }
      ),
    (err) => err.code === 'SOD_VIOLATION' && err.status === 403
  );
});

test('different user may verify', async () => {
  await assert.doesNotReject(() =>
    assertVendorBillSegregationOfDuties(
      { status: 'under_verification', submittedById: 'u1' },
      'verified',
      { _id: 'u2' }
    )
  );
});

test('submitter cannot approve unless exempt', async () => {
  await assert.rejects(
    () =>
      assertVendorBillSegregationOfDuties(
        { status: 'verified', submittedById: 'u1', verifiedById: 'u2' },
        'approved',
        { _id: 'u1', designation: 'Individual Contributor' },
        new Set()
      ),
    (err) => err.code === 'SOD_VIOLATION'
  );
});

test('verifier cannot approve', async () => {
  await assert.rejects(
    () =>
      assertVendorBillSegregationOfDuties(
        { status: 'verified', submittedById: 'u1', verifiedById: 'u2' },
        'approved',
        { _id: 'u2', designation: 'Manager' },
        new Set()
      ),
    (err) => err.code === 'SOD_VIOLATION'
  );
});

test('exempt manager may approve another submitter', async () => {
  await assert.doesNotReject(() =>
    assertVendorBillSegregationOfDuties(
      { status: 'verified', submittedById: 'u1', verifiedById: 'u2' },
      'approved',
      { _id: 'u3', designation: 'Manager' },
      new Set()
    )
  );
});

test('prior actors cannot pay', () => {
  assert.throws(
    () =>
      assertVendorBillPaySegregationOfDuties(
        { submittedById: 'u1', verifiedById: 'u2', approvedById: 'u3' },
        'u3'
      ),
    (err) => err.code === 'SOD_VIOLATION'
  );
  assert.doesNotThrow(() =>
    assertVendorBillPaySegregationOfDuties(
      { submittedById: 'u1', verifiedById: 'u2', approvedById: 'u3' },
      'u4'
    )
  );
});

test('permission matrix maps transitions', () => {
  assert.equal(
    permissionForVendorBillTransition('draft', 'submitted'),
    PERMISSIONS.FINANCE_WRITE
  );
  assert.equal(
    permissionForVendorBillTransition('under_verification', 'verified'),
    PERMISSIONS.FINANCE_VERIFY
  );
  assert.equal(
    permissionForVendorBillTransition('verified', 'approved'),
    PERMISSIONS.FINANCE_APPROVE
  );
  assert.equal(
    permissionForVendorBillTransition('under_verification', 'draft'),
    PERMISSIONS.FINANCE_VERIFY
  );
});
