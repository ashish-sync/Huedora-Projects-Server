import { describe, it, before, after } from 'node:test';
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
import { notifyRmAssetChanged, notifyRmAssetCreated } from './rmNotify.js';
import { sweepExpiredVerificationLinks, sweepUnsignedAgreements } from './rmSweeps.js';

let tempDir = '';

describe('rmNotify spec wiring', () => {
  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-notify-'));
    configurePersistence({ backend: 'file', dataDirectory: tempDir });
    await hydratePersistence();
  });

  after(() => {
    clearPersistenceCache();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function seed() {
    clearPersistenceCache();
    await saveCollection('notifications', [], { allowDestructiveSync: true });
    await saveCollection('audit_logs', [], { allowDestructiveSync: true });
    await saveCollection('roles', [
      { _id: 'role-user', name: 'User', permissions: [], isDeleted: false },
      { _id: 'role-rm', name: 'RM', permissions: ['assets:write', 'camps:approve'], isDeleted: false },
    ], { allowDestructiveSync: true });
    await saveCollection('users', [
      {
        _id: 'mgr-1',
        email: 'mgr@tylo.local',
        isActive: true,
        isDeleted: false,
        roleIds: ['role-rm'],
      },
      {
        _id: 'rep-1',
        email: 'rep@tylo.local',
        isActive: true,
        isDeleted: false,
        reportingManagerId: 'mgr-1',
        roleIds: ['role-user'],
      },
    ], { allowDestructiveSync: true });
    await saveCollection('agreements', [], { allowDestructiveSync: true });
    await saveCollection('verification_invites', [], { allowDestructiveSync: true });
  }

  it('new asset asks the direct RM to approve', async () => {
    await seed();
    const rows = await notifyRmAssetCreated({
      asset: { _id: 'a1', deviceNameSnapshot: 'Probe X', serialNumber: 'SN-1' },
      actor: { _id: 'rep-1', email: 'rep@tylo.local' },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, 'mgr-1');
    assert.equal(rows[0].type, 'ASSET_CREATE_APPROVAL');
    assert.equal(rows[0].kind, 'approval');
  });

  it('status and custody changes inform the RM only', async () => {
    await seed();
    const rows = await notifyRmAssetChanged({
      asset: { _id: 'a1', deviceNameSnapshot: 'Probe X' },
      actor: { _id: 'rep-1', email: 'rep@tylo.local' },
      statusChanged: true,
      custodyChanged: true,
      fromStatus: 'Tylo Office',
      toStatus: 'Agreement Signed',
      fromCustody: 'Tylo',
      toCustody: 'Individual',
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, 'mgr-1');
    assert.equal(rows[0].type, 'ASSET_CHANGE');
    assert.equal(rows[0].kind, 'update');
  });

  it('unsigned agreement sweep informs after 7 days', async () => {
    await seed();
    const sentAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await saveCollection('agreements', [
      {
        _id: 'ag-1',
        status: 'SENT',
        title: 'Lease',
        createdBy: 'rep-1',
        sentAt,
        isDeleted: false,
      },
    ], { allowDestructiveSync: true });
    const result = await sweepUnsignedAgreements();
    assert.equal(result.notified, 1);
    const rows = await Notification.find({ userId: 'mgr-1', type: 'AGREEMENT_UNSIGNED' });
    assert.equal(rows.length, 1);
  });

  it('expired self-verify links notify the sender RM once', async () => {
    await seed();
    await saveCollection('verification_invites', [
      {
        _id: 'inv-1',
        status: 'PENDING',
        recordId: 'rec-1',
        sentBy: 'rep-1',
        holderName: 'Custodian',
        round: 1,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        isDeleted: false,
      },
    ], { allowDestructiveSync: true });
    const first = await sweepExpiredVerificationLinks();
    const second = await sweepExpiredVerificationLinks();
    assert.equal(first.notified, 1);
    assert.equal(second.notified, 0);
    const rows = await Notification.find({ type: 'VERIFICATION_LINK_EXPIRED' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, 'mgr-1');
  });
});
