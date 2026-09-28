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
import {
  resolveManagerChainIds,
  listDirectReportIds,
  listSubtreeUserIds,
  isInManagerChain,
} from '../users/user.hierarchy.js';
import {
  expandWithReportingManagers,
  scopeApproversToSubjectManagers,
} from '../notifications/notificationRecipients.js';
import { notifyEvent } from '../notifications/notifyEvent.js';
import { Notification } from '../notifications/notification.model.js';

let tempDir = '';

describe('reporting manager notification recipients', () => {
  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notif-mgr-'));
    configurePersistence({ backend: 'file', dataDirectory: tempDir });
    await hydratePersistence();
  });

  after(() => {
    clearPersistenceCache();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    clearPersistenceCache();
    await saveCollection('users', [
      {
        _id: 'mgr-1',
        email: 'mgr@tylo.local',
        fullName: 'Manager',
        isActive: true,
        isDeleted: false,
        reportingManagerId: null,
      },
      {
        _id: 'rep-1',
        email: 'rep@tylo.local',
        fullName: 'Report',
        isActive: true,
        isDeleted: false,
        reportingManagerId: 'mgr-1',
      },
      {
        _id: 'other-1',
        email: 'other@tylo.local',
        fullName: 'Other Approver',
        isActive: true,
        isDeleted: false,
        reportingManagerId: null,
      },
      {
        _id: 'admin-1',
        email: 'admin@tylo.local',
        fullName: 'Admin',
        isActive: true,
        isDeleted: false,
        reportingManagerId: null,
      },
    ], { allowDestructiveSync: true });
    await saveCollection('notifications', [], { allowDestructiveSync: true });
  });

  it('resolves manager chain and subtree', async () => {
    assert.deepEqual(await resolveManagerChainIds('rep-1'), ['mgr-1']);
    assert.deepEqual(await listDirectReportIds('mgr-1'), ['rep-1']);
    assert.deepEqual(await listSubtreeUserIds('mgr-1'), ['rep-1']);
    assert.equal(await isInManagerChain('mgr-1', 'rep-1'), true);
    assert.equal(await isInManagerChain('other-1', 'rep-1'), false);
  });

  it('expands recipients with reporting managers', async () => {
    const ids = await expandWithReportingManagers(['rep-1'], 'chain');
    assert.deepEqual(ids.sort(), ['mgr-1', 'rep-1'].sort());
  });

  it('scopes approvers to managers of the subject plus admins', async () => {
    const users = [
      { _id: 'mgr-1' },
      { _id: 'other-1' },
      { _id: 'admin-1' },
    ];
    const scoped = await scopeApproversToSubjectManagers(users, 'rep-1', {
      isPlatformAdmin: (u) => String(u._id) === 'admin-1',
    });
    assert.deepEqual(
      scoped.map((u) => u._id).sort(),
      ['admin-1', 'mgr-1'].sort()
    );
  });

  it('notifyEvent with includeReportingManagers creates manager copy', async () => {
    await notifyEvent({
      type: 'CAMP_APPROVED',
      title: 'Camp approved',
      recipients: ['rep-1'],
      includeWatchers: false,
      includeReportingManagers: 'chain',
      group: false,
      meta: { kind: 'update' },
    });
    const forRep = await Notification.find({ userId: 'rep-1' });
    const forMgr = await Notification.find({ userId: 'mgr-1' });
    const forOther = await Notification.find({ userId: 'other-1' });
    assert.equal(forRep.length, 1);
    assert.equal(forMgr.length, 1);
    assert.equal(forOther.length, 0);
  });
});
