import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalRuleLabel,
  canApproveRequestType,
  filterApproverUsers,
  requiredApproverKeysForType,
  userMatchesApproverKeys,
} from './requestApproval.js';
import { PERMISSIONS } from '../../config/constants.js';

describe('requestApproval matrix', () => {
  it('maps request types to required approvers', () => {
    assert.deepEqual(requiredApproverKeysForType('REPAIR'), [
      'ops. manager',
      'ops. support team',
    ]);
    assert.deepEqual(requiredApproverKeysForType('MAINTENANCE'), [
      'ops. manager',
      'ops. support team',
    ]);
    assert.deepEqual(requiredApproverKeysForType('LOGISTICS'), ['ops. manager']);
    assert.deepEqual(requiredApproverKeysForType('TRAINING'), ['ops. support team']);
    assert.deepEqual(requiredApproverKeysForType('HIRING'), ['ops. manager']);
    assert.deepEqual(requiredApproverKeysForType('REIMBURSEMENT'), []);
  });

  it('allows Ops. Manager or Ops. Support Team (and pre-rename titles) for Repair & Service', () => {
    const ops = { designation: 'Ops. Manager', roleIds: [] };
    const support = { designation: 'Ops. Support Team', roleIds: [] };
    const legacyOps = { designation: 'Operations Leader', roleIds: [] };
    const legacyManager = { designation: 'Manager', roleIds: [] };
    const other = { designation: 'Camp Coordinator', roleIds: [] };
    assert.equal(canApproveRequestType(ops, new Set(), 'REPAIR'), true);
    assert.equal(canApproveRequestType(support, new Set(), 'REPAIR'), true);
    assert.equal(canApproveRequestType(legacyOps, new Set(), 'REPAIR'), true);
    assert.equal(canApproveRequestType(legacyManager, new Set(), 'REPAIR'), true);
    assert.equal(canApproveRequestType(other, new Set(), 'REPAIR'), false);
    assert.equal(canApproveRequestType(other, new Set([PERMISSIONS.ALL]), 'REPAIR'), true);
  });

  it('requires Ops. Manager for Goods Issuance and Hiring', () => {
    const ops = { designation: 'Ops. Manager', roleIds: [] };
    const support = { designation: 'Ops. Support Team', roleIds: [] };
    assert.equal(canApproveRequestType(ops, new Set(), 'LOGISTICS'), true);
    assert.equal(canApproveRequestType(support, new Set(), 'LOGISTICS'), false);
    assert.equal(canApproveRequestType(ops, new Set(), 'HIRING'), true);
    assert.equal(canApproveRequestType(support, new Set(), 'HIRING'), false);
  });

  it('requires Ops. Support Team for Training Request', () => {
    const support = { designation: 'Ops. Support Team', roles: [{ name: 'Editor' }] };
    const ops = { designation: 'Ops. Manager' };
    assert.equal(userMatchesApproverKeys(support, ['ops. support team']), true);
    assert.equal(canApproveRequestType(support, new Set(), 'TRAINING'), true);
    assert.equal(canApproveRequestType(ops, new Set(), 'TRAINING'), false);
  });

  it('filters notify recipients by matrix', () => {
    const users = [
      { _id: '1', designation: 'Manager', isActive: true },
      { _id: '2', designation: 'Ops Support Team', isActive: true },
      { _id: '3', designation: 'Product Manager', isActive: true },
    ];
    const repair = filterApproverUsers(users, 'REPAIR');
    assert.equal(repair.length, 2);
    const goods = filterApproverUsers(users, 'LOGISTICS');
    assert.equal(goods.length, 1);
    assert.equal(String(goods[0]._id), '1');
  });

  it('lets Admin approve every request type', () => {
    const adminByRole = { designation: 'Product Manager', roleIds: [{ name: 'Admin', permissions: ['*'] }] };
    const adminByDesignation = { designation: 'Admin', roleIds: [] };
    assert.equal(canApproveRequestType(adminByRole, new Set(), 'TRAINING'), true);
    assert.equal(canApproveRequestType(adminByRole, new Set(), 'LOGISTICS'), true);
    assert.equal(canApproveRequestType(adminByRole, new Set(), 'HIRING'), true);
    assert.equal(canApproveRequestType(adminByDesignation, new Set(), 'REPAIR'), true);
    assert.equal(canApproveRequestType(adminByDesignation, new Set(), 'REIMBURSEMENT'), true);
  });

  it('includes Admin in notify recipients for matrix types', () => {
    const users = [
      { _id: '1', designation: 'Manager', isActive: true },
      { _id: '2', designation: 'Product Manager', roleIds: [{ name: 'Admin', permissions: ['*'] }], isActive: true },
      { _id: '3', designation: 'Product Manager', isActive: true },
    ];
    const goods = filterApproverUsers(users, 'LOGISTICS');
    assert.equal(goods.length, 2);
    assert.deepEqual(goods.map((u) => String(u._id)).sort(), ['1', '2']);
  });

  it('labels approval rules clearly', () => {
    assert.match(approvalRuleLabel('REPAIR'), /Ops\. Manager/);
    assert.match(approvalRuleLabel('REPAIR'), /Admin/);
    assert.match(approvalRuleLabel('TRAINING'), /Ops\. Support Team/);
    assert.match(approvalRuleLabel('TRAINING'), /Admin/);
  });
});
