import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  configurePersistence,
  clearPersistenceCache,
  hydratePersistence,
  saveCollection,
} from '../../store/persistence.js';
import { Notification } from '../notifications/notification.model.js';
import { involvementKind, notifyRmInvolvement, resolveRmAudience } from './rmInvolve.js';
import { assertApprovalAuthority } from './approvalAuthority.js';
import { User } from './user.model.js';

let tempDir = '';

describe('rmInvolve', () => {
  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-involve-'));
    configurePersistence({ backend: 'file', dataDirectory: tempDir });
    await hydratePersistence();
  });

  after(() => {
    clearPersistenceCache();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    clearPersistenceCache();
    await saveCollection('roles', [
      { _id: 'role-admin', name: 'Admin', permissions: ['*'], isDeleted: false },
      { _id: 'role-user', name: 'User', permissions: [], isDeleted: false },
    ], { allowDestructiveSync: true });
    await saveCollection('users', [
      {
        _id: 'mgr-1',
        email: 'mgr@tylo.local',
        fullName: 'Manager',
        isActive: true,
        isDeleted: false,
        reportingManagerId: null,
        roleIds: ['role-user'],
      },
      {
        _id: 'rep-1',
        email: 'rep@tylo.local',
        fullName: 'Report',
        isActive: true,
        isDeleted: false,
        reportingManagerId: 'mgr-1',
        roleIds: ['role-user'],
      },
      {
        _id: 'orphan-1',
        email: 'orphan@tylo.local',
        fullName: 'Orphan',
        isActive: true,
        isDeleted: false,
        reportingManagerId: null,
        roleIds: ['role-user'],
      },
      {
        _id: 'admin-1',
        email: 'admin@tylo.local',
        fullName: 'Admin',
        isActive: true,
        isDeleted: false,
        reportingManagerId: null,
        roleIds: ['role-admin'],
        grantedPermissions: ['*'],
      },
    ], { allowDestructiveSync: true });
    await saveCollection('notifications', [], { allowDestructiveSync: true });
  });

  it('maps levels to inbox kinds', () => {
    assert.equal(involvementKind('inform'), 'update');
    assert.equal(involvementKind('review'), 'review');
    assert.equal(involvementKind('approve'), 'approval');
    assert.equal(involvementKind('escalate'), 'escalate');
  });

  it('resolves the direct RM only', async () => {
    const audience = await resolveRmAudience({ subjectUserId: 'rep-1' });
    assert.equal(audience.mode, 'direct_rm');
    assert.equal(audience.managerId, 'mgr-1');
    assert.deepEqual(audience.recipientIds, ['mgr-1']);
  });

  it('falls back to platform Admins when there is no RM', async () => {
    const audience = await resolveRmAudience({ subjectUserId: 'orphan-1' });
    assert.equal(audience.mode, 'admin_fallback');
    assert.equal(audience.managerId, null);
    assert.deepEqual(audience.recipientIds, ['admin-1']);
  });

  it('sends Approve to the RM and never to other users', async () => {
    const rows = await notifyRmInvolvement({
      level: 'approve',
      subjectUserId: 'rep-1',
      actor: { _id: 'rep-1' },
      type: 'COMMERCIAL_SUBMIT',
      title: 'INV-1 needs approval',
      entityType: 'FinanceCommercialDocument',
      entityId: 'doc-1',
      includeWatchers: false,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, 'mgr-1');
    assert.equal(rows[0].kind, 'approval');
    assert.equal(rows[0].meta.involvement, 'approve');
    assert.equal(rows[0].meta.managerId, 'mgr-1');
    const others = await Notification.find({ userId: { $in: ['rep-1', 'orphan-1'] } });
    assert.equal(others.length, 0);
  });

  it('falls back to Admins when the stored RM is inactive', async () => {
    const manager = await User.findOne({ _id: 'mgr-1' });
    manager.isActive = false;
    await manager.save();
    const audience = await resolveRmAudience({ subjectUserId: 'rep-1' });
    assert.equal(audience.mode, 'admin_fallback');
    assert.equal(audience.unavailableReason, 'inactive');
    assert.deepEqual(audience.recipientIds, ['admin-1']);
  });

  it('falls back to Admins when the RM lacks the required approval permission', async () => {
    const audience = await resolveRmAudience({
      subjectUserId: 'rep-1',
      requiredPermission: 'finance:approve',
    });
    assert.equal(audience.mode, 'admin_fallback');
    assert.equal(audience.unavailableReason, 'no_permission');
    assert.deepEqual(audience.recipientIds, ['admin-1']);
  });

  it('does not let an inactive RM approve', async () => {
    const manager = await User.findOne({ _id: 'mgr-1' });
    manager.isActive = false;
    await manager.save();
    await assert.rejects(
      () => assertApprovalAuthority({
        actor: { _id: 'mgr-1', designation: 'Manager' },
        subjectUserId: 'rep-1',
        permissions: new Set(),
      }),
      (err) => err.status === 403,
    );
  });

  it('keeps approval authority with the current RM after a hierarchy change', async () => {
    await saveCollection('users', [
      {
        _id: 'mgr-1',
        email: 'mgr@tylo.local',
        isActive: true,
        isDeleted: false,
        roleIds: ['role-user'],
      },
      {
        _id: 'mgr-2',
        email: 'mgr2@tylo.local',
        isActive: true,
        isDeleted: false,
        roleIds: ['role-user'],
      },
      {
        _id: 'rep-1',
        email: 'rep@tylo.local',
        isActive: true,
        isDeleted: false,
        reportingManagerId: 'mgr-2',
        roleIds: ['role-user'],
      },
    ], { allowDestructiveSync: true });

    await assert.rejects(
      () => assertApprovalAuthority({
        actor: { _id: 'mgr-1', designation: 'Manager' },
        subjectUserId: 'rep-1',
        permissions: new Set(),
      }),
      (err) => err.status === 403,
    );
    const allowed = await assertApprovalAuthority({
      actor: { _id: 'mgr-2', designation: 'Manager' },
      subjectUserId: 'rep-1',
      permissions: new Set(),
    });
    assert.equal(allowed.mode, 'reporting_manager');
  });

  it('does not create a second Approval on retry of the same submit', async () => {
    const payload = {
      level: 'approve',
      subjectUserId: 'rep-1',
      actor: { _id: 'rep-1' },
      type: 'COMMERCIAL_SUBMIT',
      title: 'INV-1 needs approval',
      entityType: 'FinanceCommercialDocument',
      entityId: 'doc-1',
      includeWatchers: false,
    };
    const first = await notifyRmInvolvement(payload);
    const second = await notifyRmInvolvement(payload);
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(String(first[0]._id), String(second[0]._id));
    assert.equal(second[0].title, 'INV-1 needs approval');
    const all = await Notification.find({ type: 'COMMERCIAL_SUBMIT' });
    assert.equal(all.length, 1);
  });
});
