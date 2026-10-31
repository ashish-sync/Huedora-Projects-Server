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
});
