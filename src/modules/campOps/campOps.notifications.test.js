import test from 'node:test';
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
import { notifyEvent } from '../notifications/notifyEvent.js';
import { Notification } from '../notifications/notification.model.js';
import { resolveEventMeta, NOTIFICATION_PRIORITIES } from '../notifications/notificationCatalog.js';
import { notifyCampBulkSummary, notifyCampCreates, notifyCampHcwGapApproval, notifyCampWorkflow } from './campOps.notifications.js';
import { localTodayIso } from './campDatePolicy.js';

let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camp-notif-'));
  configurePersistence({ backend: 'file', dataDirectory: tempDir });
  await hydratePersistence();
});

test.after(async () => {
  clearPersistenceCache();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function resetNotifications(users = []) {
  clearPersistenceCache();
  await saveCollection('notifications', [], { allowDestructiveSync: true });
  await saveCollection('roles', [
    { _id: 'role-user', name: 'User', permissions: [], isDeleted: false },
    { _id: 'role-camp-rm', name: 'Camp RM', permissions: ['camps:approve'], isDeleted: false },
    { _id: 'role-admin', name: 'Admin', permissions: ['*'], isDeleted: false },
  ], { allowDestructiveSync: true });
  await saveCollection('users', users, { allowDestructiveSync: true });
}

function rmUsers() {
  return [
    {
      _id: 'mgr-1',
      email: 'mgr@tylo.local',
      isActive: true,
      isDeleted: false,
      roleIds: ['role-camp-rm'],
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
      _id: 'coord-1',
      email: 'coord@tylo.local',
      isActive: true,
      isDeleted: false,
      roleIds: ['role-user'],
    },
    {
      _id: 'admin-1',
      email: 'admin@tylo.local',
      isActive: true,
      isDeleted: false,
      roleIds: ['role-admin'],
      grantedPermissions: ['*'],
    },
  ];
}

test('catalog maps camp bulk events to camp module priorities', () => {
  assert.equal(resolveEventMeta('CAMP_BULK_PARTIAL').priority, NOTIFICATION_PRIORITIES.CRITICAL);
  assert.equal(resolveEventMeta('CAMP_BULK_SUCCESS').module, 'camp');
  assert.equal(resolveEventMeta('CAMP_APPROVED').priority, NOTIFICATION_PRIORITIES.IMPORTANT);
});

test('notifyEvent sorts newest first when listed by createdAt desc', async () => {
  await resetNotifications();
  const userId = 'user-notif-1';
  await notifyEvent({
    type: 'CAMP_REVIEW',
    title: 'Older',
    recipients: [userId],
    includeWatchers: false,
    group: false,
  });
  await new Promise((r) => setTimeout(r, 5));
  await notifyEvent({
    type: 'CAMP_REVIEW',
    title: 'Newer',
    recipients: [userId],
    includeWatchers: false,
    group: false,
  });
  const rows = await Notification.find({ userId }).sort({ createdAt: -1 });
  assert.equal(rows[0].title, 'Newer');
  assert.equal(rows[1].title, 'Older');
});

test('notifyEvent groups duplicate unread events for the same entity', async () => {
  await resetNotifications();
  const userId = 'user-group-1';
  const first = await notifyEvent({
    type: 'ENTITY_WATCH_UPDATE',
    title: 'Watched camp updated',
    entityType: 'camp_ops_camp',
    entityId: 'camp-1',
    recipients: [userId],
    includeWatchers: false,
    group: true,
  });
  const second = await notifyEvent({
    type: 'ENTITY_WATCH_UPDATE',
    title: 'Watched camp updated',
    entityType: 'camp_ops_camp',
    entityId: 'camp-1',
    recipients: [userId],
    includeWatchers: false,
    group: true,
  });
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(String(first[0]._id), String(second[0]._id));
  assert.equal(second[0].groupCount, 2);
  const all = await Notification.find({ userId });
  assert.equal(all.length, 1);
});

test('notifyCampWorkflow ignores routine lifecycle actions', async () => {
  await resetNotifications();
  await notifyCampWorkflow({
    camp: { _id: 'c1', campId: '26-08-0001', createdById: 'u1' },
    action: 'assignment_save',
    actorId: 'actor-1',
  });
  const rows = await Notification.find({});
  assert.equal(rows.length, 0);
});

test('notifyCampBulkSummary informs the actor RM, not the actor', async () => {
  await resetNotifications(rmUsers());
  const created = await notifyCampBulkSummary({
    action: 'import',
    actorId: 'rep-1',
    success: Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, campId: `C${i}` })),
    skipped: [{ reason: 'duplicate' }, { reason: 'missing client' }],
    failed: [{ reason: 'invalid date' }],
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].userId, 'mgr-1');
  assert.equal(created[0].kind, 'update');
  assert.equal(created[0].meta.involvement, 'inform');
  assert.match(created[0].title, /100 succeeded/);
  assert.match(created[0].title, /2 skipped/);
  assert.match(created[0].title, /1 failed/);
  assert.equal(created[0].type, 'CAMP_BULK_PARTIAL');
  assert.equal(created[0].meta.successCount, 100);
  assert.equal(created[0].meta.skippedCount, 2);
  assert.equal(created[0].meta.failedCount, 1);

  const forActor = await Notification.find({ userId: 'rep-1' });
  assert.equal(forActor.length, 0);
});

test('camp submit informs the requester RM and does not fan out to coordinators', async () => {
  await resetNotifications(rmUsers());
  await notifyCampWorkflow({
    camp: { _id: 'c1', campId: '26-08-0001', createdById: 'rep-1' },
    action: 'submit_review',
    actorId: 'rep-1',
  });
  const forMgr = await Notification.find({ userId: 'mgr-1' });
  const forCoord = await Notification.find({ userId: 'coord-1' });
  assert.equal(forMgr.length, 1);
  assert.equal(forMgr[0].type, 'CAMP_REVIEW');
  assert.equal(forMgr[0].kind, 'update');
  assert.equal(forMgr[0].meta.involvement, 'inform');
  assert.equal(forCoord.length, 0);
});

test('routine camp create does not notify the RM', async () => {
  await resetNotifications(rmUsers());
  const future = new Date();
  future.setDate(future.getDate() + 10);
  const y = future.getFullYear();
  const m = String(future.getMonth() + 1).padStart(2, '0');
  const d = String(future.getDate()).padStart(2, '0');
  await notifyCampWorkflow({
    camp: {
      _id: 'c-routine',
      campId: '26-11-0001',
      createdById: 'rep-1',
      campDate: `${y}-${m}-${d}`,
      requestDate: localTodayIso(),
    },
    action: 'create',
    actorId: 'rep-1',
  });
  const rows = await Notification.find({ userId: 'mgr-1' });
  assert.equal(rows.length, 0);
});

test('imminent camp create does not ask the RM to approve', async () => {
  await resetNotifications(rmUsers());
  const soon = new Date();
  soon.setDate(soon.getDate() + 1);
  const y = soon.getFullYear();
  const m = String(soon.getMonth() + 1).padStart(2, '0');
  const d = String(soon.getDate()).padStart(2, '0');
  await notifyCampWorkflow({
    camp: {
      _id: 'c-soon',
      campId: '26-11-0003',
      createdById: 'rep-1',
      campDate: `${y}-${m}-${d}`,
      requestDate: localTodayIso(),
    },
    action: 'create',
    actorId: 'rep-1',
  });
  const rows = await Notification.find({ userId: 'mgr-1' });
  assert.equal(rows.length, 0);
});

test('historical request date create asks the RM to approve', async () => {
  await resetNotifications(rmUsers());
  const old = new Date();
  old.setDate(old.getDate() - 3);
  const y = old.getFullYear();
  const m = String(old.getMonth() + 1).padStart(2, '0');
  const d = String(old.getDate()).padStart(2, '0');
  const soon = new Date();
  soon.setDate(soon.getDate() + 10);
  const cy = soon.getFullYear();
  const cm = String(soon.getMonth() + 1).padStart(2, '0');
  const cd = String(soon.getDate()).padStart(2, '0');
  await notifyCampWorkflow({
    camp: {
      _id: 'c-old-req',
      campId: '26-11-0004',
      createdById: 'rep-1',
      campDate: `${cy}-${cm}-${cd}`,
      requestDate: `${y}-${m}-${d}`,
    },
    action: 'create',
    actorId: 'rep-1',
  });
  const rows = await Notification.find({ userId: 'mgr-1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'CAMP_T2_APPROVAL');
  assert.match(rows[0].title, /request date is more than 2 days before today/);
});

test('historical camp create asks the RM to approve', async () => {
  await resetNotifications(rmUsers());
  const old = new Date();
  old.setDate(old.getDate() - 3);
  const y = old.getFullYear();
  const m = String(old.getMonth() + 1).padStart(2, '0');
  const d = String(old.getDate()).padStart(2, '0');
  await notifyCampWorkflow({
    camp: {
      _id: 'c-t2',
      campId: '26-11-0002',
      createdById: 'rep-1',
      campDate: `${y}-${m}-${d}`,
      requestDate: localTodayIso(),
    },
    action: 'create',
    actorId: 'rep-1',
  });
  const rows = await Notification.find({ userId: 'mgr-1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'CAMP_T2_APPROVAL');
  assert.equal(rows[0].kind, 'approval');
  assert.match(rows[0].title, /more than 2 days before today/);
});

test('camp off-hours stay Review; overdue informs the RM', async () => {
  await resetNotifications(rmUsers());
  await notifyCampWorkflow({
    camp: {
      _id: 'c2',
      campId: '26-08-0002',
      createdById: 'rep-1',
      submittedOffHours: true,
    },
    action: 'submit_review',
    actorId: 'rep-1',
  });
  await notifyCampWorkflow({
    camp: { _id: 'c3', campId: '26-08-0003', createdById: 'rep-1' },
    action: 'review_overdue',
  });
  const rows = await Notification.find({ userId: 'mgr-1' });
  const reviews = rows.filter((row) => row.kind === 'review');
  const informs = rows.filter((row) => row.kind === 'update' && row.type === 'CAMP_REVIEW_OVERDUE');
  assert.ok(reviews.some((row) => row.type === 'CAMP_OFF_HOURS'));
  assert.equal(informs.length, 1);
  assert.equal(informs[0].meta.involvement, 'inform');
});

test('Tylo Care cancellation informs the requester RM', async () => {
  await resetNotifications(rmUsers());
  await notifyCampWorkflow({
    camp: { _id: 'c5', campId: '26-11-0005', createdById: 'rep-1' },
    action: 'cancel_tylo',
    actorId: 'coord-1',
    note: 'Client site closed',
  });
  const rows = await Notification.find({ userId: 'mgr-1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'CAMP_CANCELLED_TYLO');
  assert.equal(rows[0].kind, 'update');
});

test('HCW gap stays Approve for the assigner RM', async () => {
  await resetNotifications(rmUsers());
  const rows = await notifyCampHcwGapApproval({
    camp: { _id: 'c4', campId: '26-08-0004', hcwName: 'Asha' },
    actorId: 'rep-1',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, 'mgr-1');
  assert.equal(rows[0].kind, 'approval');
  assert.equal(rows[0].type, 'CAMP_HCW_GAP_APPROVAL');
});

test('public-form historical create uses the program owner RM when there is no actor', async () => {
  await resetNotifications(rmUsers());
  const old = new Date();
  old.setDate(old.getDate() - 3);
  const y = old.getFullYear();
  const m = String(old.getMonth() + 1).padStart(2, '0');
  const d = String(old.getDate()).padStart(2, '0');
  await notifyCampCreates([
    {
      _id: 'import-public',
      campId: '26-11-pub-1',
      createdById: null,
      campDate: `${y}-${m}-${d}`,
      requestDate: localTodayIso(),
    },
  ], null, { fallbackSubjectId: 'rep-1' });
  const forMgr = await Notification.find({ userId: 'mgr-1' });
  const forAdmin = await Notification.find({ userId: 'admin-1' });
  assert.equal(forMgr.length, 1);
  assert.equal(forMgr[0].type, 'CAMP_T2_APPROVAL');
  assert.equal(forAdmin.length, 0);
});

test('anonymous historical create falls back to platform Admins, not every Approver', async () => {
  await resetNotifications(rmUsers());
  const old = new Date();
  old.setDate(old.getDate() - 3);
  const y = old.getFullYear();
  const m = String(old.getMonth() + 1).padStart(2, '0');
  const d = String(old.getDate()).padStart(2, '0');
  await notifyCampCreates([
    {
      _id: 'import-anon',
      campId: '26-11-anon-1',
      createdById: null,
      campDate: `${y}-${m}-${d}`,
      requestDate: localTodayIso(),
    },
  ], null);
  const forAdmin = await Notification.find({ userId: 'admin-1' });
  const forMgr = await Notification.find({ userId: 'mgr-1' });
  const forCoord = await Notification.find({ userId: 'coord-1' });
  assert.equal(forAdmin.length, 1);
  assert.equal(forAdmin[0].type, 'CAMP_T2_APPROVAL');
  assert.equal(forMgr.length, 0);
  assert.equal(forCoord.length, 0);
});

test('imported historical camps use the same RM create approval as dashboard create', async () => {
  await resetNotifications(rmUsers());
  const old = new Date();
  old.setDate(old.getDate() - 3);
  const y = old.getFullYear();
  const m = String(old.getMonth() + 1).padStart(2, '0');
  const d = String(old.getDate()).padStart(2, '0');
  const soon = new Date();
  soon.setDate(soon.getDate() + 10);
  const cy = soon.getFullYear();
  const cm = String(soon.getMonth() + 1).padStart(2, '0');
  const cd = String(soon.getDate()).padStart(2, '0');

  await notifyCampCreates([
    {
      _id: 'import-hist',
      campId: '26-11-imp-1',
      createdById: 'rep-1',
      campDate: `${y}-${m}-${d}`,
      requestDate: localTodayIso(),
    },
    {
      _id: 'import-ok',
      campId: '26-11-imp-2',
      createdById: 'rep-1',
      campDate: `${cy}-${cm}-${cd}`,
      requestDate: localTodayIso(),
    },
  ], 'rep-1');

  const rows = await Notification.find({ userId: 'mgr-1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'CAMP_T2_APPROVAL');
  assert.equal(rows[0].entityId, 'import-hist');
});

test('notifyCampBulkSummary is a no-op without actor or rows', async () => {
  await resetNotifications();
  assert.deepEqual(await notifyCampBulkSummary({ action: 'approve', actorId: 'x' }), []);
  assert.deepEqual(
    await notifyCampBulkSummary({
      action: 'approve',
      success: [{ id: '1' }],
    }),
    [],
  );
});
