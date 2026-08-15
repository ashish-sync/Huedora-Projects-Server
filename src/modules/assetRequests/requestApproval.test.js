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
      'operations leader',
      'training manager',
    ]);
    assert.deepEqual(requiredApproverKeysForType('MAINTENANCE'), [
      'operations leader',
      'training manager',
    ]);
    assert.deepEqual(requiredApproverKeysForType('LOGISTICS'), ['operations leader']);
    assert.deepEqual(requiredApproverKeysForType('TRAINING'), ['training manager']);
    assert.deepEqual(requiredApproverKeysForType('HIRING'), ['operations leader']);
    assert.deepEqual(requiredApproverKeysForType('REIMBURSEMENT'), []);
  });

  it('allows either Operations Leader or Training Manager for Repair & Service', () => {
    const ops = { designation: 'Operations Leader', roleIds: [] };
    const training = { designation: 'Training Manager', roleIds: [] };
    const other = { designation: 'Manager', roleIds: [] };
    assert.equal(canApproveRequestType(ops, new Set(), 'REPAIR'), true);
    assert.equal(canApproveRequestType(training, new Set(), 'REPAIR'), true);
    assert.equal(canApproveRequestType(other, new Set(), 'REPAIR'), false);
    assert.equal(canApproveRequestType(other, new Set([PERMISSIONS.ALL]), 'REPAIR'), true);
  });

  it('requires Operations Leader for Goods Issuance and Hiring', () => {
    const ops = { designation: 'Operations Head', roleIds: [] };
    const training = { designation: 'Training Manager', roleIds: [] };
    assert.equal(canApproveRequestType(ops, new Set(), 'LOGISTICS'), true);
    assert.equal(canApproveRequestType(training, new Set(), 'LOGISTICS'), false);
    assert.equal(canApproveRequestType(ops, new Set(), 'HIRING'), true);
    assert.equal(canApproveRequestType(training, new Set(), 'HIRING'), false);
  });

  it('requires Training Manager for Training Request', () => {
    const training = { designation: 'Training Manager', roles: [{ name: 'Editor' }] };
    const ops = { designation: 'Operations Leader' };
    assert.equal(userMatchesApproverKeys(training, ['training manager']), true);
    assert.equal(canApproveRequestType(training, new Set(), 'TRAINING'), true);
    assert.equal(canApproveRequestType(ops, new Set(), 'TRAINING'), false);
  });

  it('filters notify recipients by matrix', () => {
    const users = [
      { _id: '1', designation: 'Operations Leader', isActive: true },
      { _id: '2', designation: 'Training Manager', isActive: true },
      { _id: '3', designation: 'Manager', isActive: true },
    ];
    const repair = filterApproverUsers(users, 'REPAIR');
    assert.equal(repair.length, 2);
    const goods = filterApproverUsers(users, 'LOGISTICS');
    assert.equal(goods.length, 1);
    assert.equal(String(goods[0]._id), '1');
  });

  it('labels approval rules clearly', () => {
    assert.match(approvalRuleLabel('REPAIR'), /Operations Leader or Training Manager/);
    assert.match(approvalRuleLabel('TRAINING'), /Training Manager/);
  });
});
