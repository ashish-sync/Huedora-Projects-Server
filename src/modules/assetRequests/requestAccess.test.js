import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS } from '../../config/constants.js';
import {
  applyActorListScope,
  canCancelRequest,
  canProcessRequestType,
  canViewRequest,
  cancelRequiresRemark,
  isDirectManagerOfRequestor,
  listFilterForActor,
  managePermissionForType,
  managedRequestTypes,
} from './requestAccess.js';

describe('requestAccess type-scoped helpers', () => {
  const rishu = { _id: 'u-rishu', systemRole: 'User' };
  const rasikaRecruiter = { _id: 'u-rasika', systemRole: 'User' };
  const accounts = { _id: 'u-accounts', systemRole: 'User' };
  const rishuRm = { _id: 'u-rishu-rm', systemRole: 'User' };
  const admin = { _id: 'u-admin', systemRole: 'Super Admin' };

  const hiringByRishu = {
    requestType: 'HIRING',
    requestorId: { _id: 'u-rishu', reportingManagerId: 'u-rishu-rm' },
  };
  const financeByRasika = {
    requestType: 'REIMBURSEMENT',
    requestorId: { _id: 'u-rasika', reportingManagerId: 'u-rasika-rm' },
  };

  it('maps request types to manage permissions', () => {
    assert.equal(managePermissionForType('REPAIR'), PERMISSIONS.ASSET_REQUESTS_SERVICE_MANAGE);
    assert.equal(managePermissionForType('HIRING'), PERMISSIONS.ASSET_REQUESTS_HIRING_MANAGE);
    assert.equal(managePermissionForType('REIMBURSEMENT'), PERMISSIONS.ASSET_REQUESTS_FINANCE_MANAGE);
    assert.equal(managePermissionForType('MASTER_ADD'), null);
  });

  it('Scenario 1: Hiring visible to creator, RM, recruiter — not Accounts', () => {
    const hirePerms = new Set([PERMISSIONS.ASSET_REQUESTS_HIRING_MANAGE]);
    const accountsPerms = new Set([PERMISSIONS.ASSET_REQUESTS_FINANCE_MANAGE]);
    const createPerms = new Set([PERMISSIONS.ASSET_REQUESTS_REQUEST]);

    assert.equal(canViewRequest(rishu, createPerms, hiringByRishu), true);
    assert.equal(isDirectManagerOfRequestor(rishuRm, hiringByRishu), true);
    assert.equal(canViewRequest(rishuRm, createPerms, hiringByRishu), true);
    assert.equal(canViewRequest(rasikaRecruiter, hirePerms, hiringByRishu), true);
    assert.equal(canProcessRequestType(rasikaRecruiter, hirePerms, 'HIRING'), true);
    assert.equal(canViewRequest(accounts, accountsPerms, hiringByRishu), false);
    assert.equal(canProcessRequestType(accounts, accountsPerms, 'HIRING'), false);
    assert.equal(canViewRequest(admin, new Set(), hiringByRishu), true);
  });

  it('Scenario 2: Finance visible to creator, RM, Accounts — not Recruiter', () => {
    const hirePerms = new Set([PERMISSIONS.ASSET_REQUESTS_HIRING_MANAGE]);
    const accountsPerms = new Set([PERMISSIONS.ASSET_REQUESTS_FINANCE_MANAGE]);
    const createPerms = new Set([PERMISSIONS.ASSET_REQUESTS_REQUEST]);

    assert.equal(canViewRequest(rasikaRecruiter, createPerms, financeByRasika), true);
    assert.equal(canViewRequest(accounts, accountsPerms, financeByRasika), true);
    assert.equal(canProcessRequestType(accounts, accountsPerms, 'REIMBURSEMENT'), true);
    assert.equal(canViewRequest(rasikaRecruiter, hirePerms, financeByRasika), true); // creator
    assert.equal(
      canViewRequest(
        { _id: 'u-other-recruiter', systemRole: 'User' },
        hirePerms,
        financeByRasika
      ),
      false
    );
    assert.equal(canProcessRequestType(rasikaRecruiter, hirePerms, 'REIMBURSEMENT'), false);
  });

  it('never lets asset-requests:approve cross-grant type process rights', () => {
    const perms = new Set([PERMISSIONS.ASSET_REQUESTS_APPROVE]);
    assert.equal(canProcessRequestType(rasikaRecruiter, perms, 'HIRING'), false);
    assert.equal(canProcessRequestType(rasikaRecruiter, perms, 'REIMBURSEMENT'), false);
    assert.deepEqual(managedRequestTypes(rasikaRecruiter, perms), []);
  });

  it('lets creators cancel own requests with mandatory remark; RM cannot cancel', () => {
    const perms = new Set([PERMISSIONS.ASSET_REQUESTS_REQUEST]);
    assert.equal(canCancelRequest(rishu, perms, hiringByRishu), true);
    assert.equal(cancelRequiresRemark(rishu, hiringByRishu), true);
    assert.equal(canCancelRequest(rishuRm, perms, hiringByRishu), false);
  });

  it('scopes list filter to own + reports + managed types only', async () => {
    const perms = new Set([PERMISSIONS.ASSET_REQUESTS_HIRING_MANAGE]);
    const scope = await listFilterForActor(rasikaRecruiter, perms, {
      reportIds: ['u-report-1'],
    });
    assert.deepEqual(scope, {
      $or: [
        { requestorId: 'u-rasika' },
        { requestorId: { $in: ['u-report-1'] } },
        { requestType: { $in: ['HIRING'] } },
      ],
    });
    assert.equal(await listFilterForActor(admin, new Set()), null);

    const filter = { isDeleted: false };
    await applyActorListScope(filter, rasikaRecruiter, perms, { reportIds: [] });
    assert.ok(Array.isArray(filter.$and));
    assert.equal(filter.$and.length, 1);
  });
});
