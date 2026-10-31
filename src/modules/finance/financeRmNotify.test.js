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
import {
  notifyCommercialDecision,
  notifyCommercialSubmitted,
  notifyVendorBillDecision,
  notifyVendorBillVerified,
} from './financeRmNotify.js';

let tempDir = '';

describe('finance RM notify', () => {
  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-rm-'));
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
      { _id: 'role-user', name: 'User', permissions: [], isDeleted: false },
    ], { allowDestructiveSync: true });
    await saveCollection('users', [
      {
        _id: 'mgr-1',
        email: 'mgr@tylo.local',
        isActive: true,
        isDeleted: false,
        roleIds: ['role-user'],
      },
      {
        _id: 'rep-1',
        email: 'rep@tylo.local',
        isActive: true,
        isDeleted: false,
        reportingManagerId: 'mgr-1',
        roleIds: ['role-user'],
      },
      {
        _id: 'verifier-1',
        email: 'verify@tylo.local',
        isActive: true,
        isDeleted: false,
        roleIds: ['role-user'],
      },
    ], { allowDestructiveSync: true });
    await saveCollection('notifications', [], { allowDestructiveSync: true });
  });

  it('commercial submit creates one Approval for the RM', async () => {
    const rows = await notifyCommercialSubmitted({
      row: { _id: 'doc-1', documentNumber: 'INV-9', documentType: 'client_invoice' },
      actor: { _id: 'rep-1' },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, 'mgr-1');
    assert.equal(rows[0].kind, 'approval');
    assert.equal(rows[0].type, 'COMMERCIAL_SUBMIT');
    assert.equal(rows[0].meta.involvement, 'approve');
  });

  it('commercial approve creates Inform for the submitter, not a second Approval', async () => {
    const rows = await notifyCommercialDecision({
      row: {
        _id: 'doc-1',
        documentNumber: 'INV-9',
        submittedById: 'rep-1',
      },
      actor: { _id: 'mgr-1' },
      approved: true,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, 'rep-1');
    assert.equal(rows[0].kind, 'update');
    assert.equal(rows[0].type, 'COMMERCIAL_APPROVED');
    const forMgr = await Notification.find({ userId: 'mgr-1' });
    assert.equal(forMgr.length, 0);
  });

  it('vendor bill verified creates Approval for the submitter RM', async () => {
    const rows = await notifyVendorBillVerified({
      row: {
        _id: 'bill-1',
        billNumber: 'VB-2',
        submittedById: 'rep-1',
      },
      actor: { _id: 'verifier-1' },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, 'mgr-1');
    assert.equal(rows[0].kind, 'approval');
    assert.equal(rows[0].type, 'VENDOR_BILL_VERIFIED');
  });

  it('vendor bill decision informs the submitter', async () => {
    const rows = await notifyVendorBillDecision({
      row: {
        _id: 'bill-1',
        billNumber: 'VB-2',
        submittedById: 'rep-1',
      },
      actor: { _id: 'mgr-1' },
      approved: false,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, 'rep-1');
    assert.equal(rows[0].kind, 'update');
    assert.equal(rows[0].type, 'VENDOR_BILL_REJECTED');
  });
});
