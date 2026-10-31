import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isApprovalExemptDesignation,
  isApprovalAuthorityExempt,
  canActorApproveSubjectSync,
} from './approvalAuthority.js';

test('exempt designations: Director and Business Head only', () => {
  assert.equal(isApprovalExemptDesignation('Director'), true);
  assert.equal(isApprovalExemptDesignation('Business Head'), true);
  assert.equal(isApprovalExemptDesignation('Regional Director'), true);
});

test('Manager titles are not exempt', () => {
  assert.equal(isApprovalExemptDesignation('Manager'), false);
  assert.equal(isApprovalExemptDesignation('Senior Manager'), false);
  assert.equal(isApprovalExemptDesignation('Operations Manager'), false);
  assert.equal(isApprovalExemptDesignation('Training Manager'), false);
  assert.equal(isApprovalExemptDesignation('Product Manager'), false);
});

test('non-exempt designations', () => {
  assert.equal(isApprovalExemptDesignation('Individual Contributor'), false);
  assert.equal(isApprovalExemptDesignation('Team Lead'), false);
  assert.equal(isApprovalExemptDesignation('Operations Leader'), false);
  assert.equal(isApprovalExemptDesignation('Operations Head'), false);
  assert.equal(isApprovalExemptDesignation('Healthcare Camp Coordinator'), false);
  assert.equal(isApprovalExemptDesignation(''), false);
});

test('platform admin is authority-exempt; Manager title is not', () => {
  assert.equal(isApprovalAuthorityExempt({ designation: 'IC' }, new Set(['*'])), true);
  assert.equal(isApprovalAuthorityExempt({ designation: 'Manager' }, new Set()), false);
  assert.equal(isApprovalAuthorityExempt({ designation: 'Senior Manager' }, new Set()), false);
  assert.equal(isApprovalAuthorityExempt({ designation: 'Director' }, new Set()), true);
  assert.equal(isApprovalAuthorityExempt({ designation: 'IC' }, new Set()), false);
});

test('sync UI gate: self only when Admin/Director/BH; others when RM', () => {
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
      { _id: 'u1', designation: 'Senior Manager' },
      subject,
      new Set(),
    ),
    false,
  );
  assert.equal(
    canActorApproveSubjectSync(
      { _id: 'u1', designation: 'Operations Manager' },
      subject,
      new Set(),
    ),
    false,
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
