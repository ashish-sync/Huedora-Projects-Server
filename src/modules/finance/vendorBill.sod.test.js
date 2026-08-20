import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS } from '../../config/constants.js';
import {
  assertVendorBillSegregationOfDuties,
  assertVendorBillPaySegregationOfDuties,
  permissionForVendorBillTransition,
} from './vendorBill.sod.js';

test('submitter cannot verify', () => {
  assert.throws(
    () =>
      assertVendorBillSegregationOfDuties(
        { status: 'under_verification', submittedById: 'u1' },
        'verified',
        'u1'
      ),
    (err) => err.code === 'SOD_VIOLATION' && err.status === 403
  );
});

test('different user may verify', () => {
  assert.doesNotThrow(() =>
    assertVendorBillSegregationOfDuties(
      { status: 'under_verification', submittedById: 'u1' },
      'verified',
      'u2'
    )
  );
});

test('submitter or verifier cannot approve', () => {
  assert.throws(
    () =>
      assertVendorBillSegregationOfDuties(
        { status: 'verified', submittedById: 'u1', verifiedById: 'u2' },
        'approved',
        'u1'
      ),
    (err) => err.code === 'SOD_VIOLATION'
  );
  assert.throws(
    () =>
      assertVendorBillSegregationOfDuties(
        { status: 'verified', submittedById: 'u1', verifiedById: 'u2' },
        'approved',
        'u2'
      ),
    (err) => err.code === 'SOD_VIOLATION'
  );
});

test('third party may approve', () => {
  assert.doesNotThrow(() =>
    assertVendorBillSegregationOfDuties(
      { status: 'verified', submittedById: 'u1', verifiedById: 'u2' },
      'approved',
      'u3'
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
