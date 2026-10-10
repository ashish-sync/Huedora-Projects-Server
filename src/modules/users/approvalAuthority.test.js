import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isApprovalExemptDesignation,
  isApprovalAuthorityExempt,
  canActorApproveSubjectSync,
} from './approvalAuthority.js';

test('exempt designations: Director, Business Head, any Manager', () => {
  assert.equal(isApprovalExemptDesignation('Director'), true);
  assert.equal(isApprovalExemptDesignation('Business Head'), true);
  assert.equal(isApprovalExemptDesignation('Manager'), true);
  assert.equal(isApprovalExemptDesignation('Senior Manager'), true);
  assert.equal(isApprovalExemptDesignation('Operations Manager'), true);
  assert.equal(isApprovalExemptDesignation('Training Manager'), true);
  assert.equal(isApprovalExemptDesignation('Product Manager'), true);
});

test('non-exempt designations', () => {
  assert.equal(isApprovalExemptDesignation('Individual Contributor'), false);
  assert.equal(isApprovalExemptDesignation('Team Lead'), false);
  assert.equal(isApprovalExemptDesignation('Operations Leader'), false);
  assert.equal(isApprovalExemptDesignation('Operations Head'), false);
  assert.equal(isApprovalExemptDesignation('Healthcare Camp Coordinator'), false);
  assert.equal(isApprovalExemptDesignation(''), false);
});

test('platform admin is authority-exempt', () => {
  assert.equal(isApprovalAuthorityExempt({ designation: 'IC' }, new Set(['*'])), true);
  assert.equal(isApprovalAuthorityExempt({ designation: 'Manager' }, new Set()), true);
  assert.equal(isApprovalAuthorityExempt({ designation: 'IC' }, new Set()), false);
});

test('sync UI gate: self only when exempt; others when RM or exempt', () => {
  const manager = { _id: 'm1', designation: 'Manager' };
  const ic = { _id: 'u1', designation: 'Individual Contributor' };
  const subject = { _id: 'u1', reportingManagerId: 'm1' };

  assert.equal(canActorApproveSubjectSync(ic, subject, new Set()), false);
  assert.equal(canActorApproveSubjectSync(manager, subject, new Set()), true);
  assert.equal(
    canActorApproveSubjectSync(
      { _id: 'u1', designation: 'Director' },
      subject,
      new Set(),
    ),
    true,
  );
  assert.equal(
    canActorApproveSubjectSync(
      { _id: 'other', designation: 'Operations Leader' },
      subject,
      new Set(['asset-requests:approve']),
    ),
    false,
  );
});
