import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAssignedUserEmails,
  applyClientScopeToFilter,
  applyClientScopeToIdField,
  isClientIdInScope,
  isClientMasterInScope,
  resolveCampClientScope,
  assertCampClientAccess,
} from './campOps.clientAccess.js';
import {
  campMatchesProgramAssignment,
  resolveAssignedUserEmailsFromRecords,
} from './clientMaster.programScope.js';
import { CampOpsClientMaster } from './campOps.model.js';
import { PERMISSIONS } from '../../config/constants.js';
import { AppError } from '../../utils/helpers.js';

test('parseAssignedUserEmails normalizes and dedupes', () => {
  assert.deepEqual(
    parseAssignedUserEmails('Ops@Client.com; ops@client.com\nuser@client.in'),
    ['ops@client.com', 'user@client.in'],
  );
});

test('applyClientScopeToFilter restricts to assigned clientIds', () => {
  const scoped = [{ clientId: 'aaaaaaaaaaaaaaaaaaaaaaaa', programName: 'Ortho', campName: 'BMD' }];
  assert.deepEqual(
    applyClientScopeToFilter({ isDeleted: false }, scoped),
    { isDeleted: false, clientId: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
  );
  assert.equal(
    applyClientScopeToFilter({ isDeleted: false, clientId: 'cccccccccccccccccccccccc' }, scoped).clientId,
    '__none__',
  );
  assert.deepEqual(
    applyClientScopeToFilter({ isDeleted: false, clientId: 'AAAAAAAAAAAAAAAAaaaaaaaa' }, scoped),
    { isDeleted: false, clientId: 'AAAAAAAAAAAAAAAAaaaaaaaa' },
  );
  assert.equal(applyClientScopeToFilter({ isDeleted: false }, []).clientId, '__none__');
  assert.deepEqual(applyClientScopeToFilter({ isDeleted: false }, null), { isDeleted: false });
});

test('applyClientScopeToIdField scopes brand _id lists', () => {
  const scoped = [{ clientId: 'aaaaaaaaaaaaaaaaaaaaaaaa', programName: 'Ortho', campName: 'BMD' }];
  assert.deepEqual(
    applyClientScopeToIdField({ isDeleted: false }, scoped, '_id'),
    { isDeleted: false, _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
  );
});

test('isClientIdInScope compares hex ids case-insensitively', () => {
  const scoped = [{ clientId: 'aaaaaaaaaaaaaaaaaaaaaaaa', programName: 'Ortho', campName: 'BMD' }];
  assert.equal(isClientIdInScope(null, 'anything'), true);
  assert.equal(isClientIdInScope(scoped, 'AAAAAAAAAAAAAAAAaaaaaaaa'), true);
  assert.equal(isClientIdInScope(scoped, 'bbbbbbbbbbbbbbbbbbbbbbbb'), false);
});

test('isClientMasterInScope matches client + division + method', () => {
  const scoped = [{ clientId: 'aaaaaaaaaaaaaaaaaaaaaaaa', programName: 'Ortho', campName: 'BMD' }];
  assert.equal(isClientMasterInScope(scoped, {
    clientId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    programName: 'Ortho',
    campName: 'BMD',
  }), true);
  assert.equal(isClientMasterInScope(scoped, {
    clientId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    programName: 'Cardio',
    campName: 'BMD',
  }), false);
});

test('campMatchesProgramAssignment matches camp division and method', () => {
  assert.equal(campMatchesProgramAssignment({
    clientId: 'abc',
    campaignType: 'Ortho',
    campaignName: 'BMD',
  }, {
    clientId: 'abc',
    programName: 'Ortho',
    campName: 'BMD',
  }), true);
  assert.equal(campMatchesProgramAssignment({
    clientId: 'abc',
    campaignType: 'Ortho',
    campaignName: 'Screening',
  }, {
    clientId: 'abc',
    programName: 'Ortho',
    campName: 'BMD',
  }), false);
});

test('resolveAssignedUserEmailsFromRecords unions emails for exact program scope', () => {
  assert.deepEqual(resolveAssignedUserEmailsFromRecords([
    {
      programName: 'Ortho',
      campName: 'BMD',
      assignedUserEmails: ['ops@client.com'],
      isActive: true,
    },
    {
      programName: 'Ortho',
      campName: 'BMD',
      assignedUserEmails: ['ops@client.com', 'user@client.in'],
      isActive: true,
    },
  ], { programName: 'Ortho', campName: 'BMD' }), ['ops@client.com', 'user@client.in']);
});

test('resolveCampClientScope scopes listed users to client + division + method', async (t) => {
  const suffix = Date.now();
  const assignedEmail = `assigned-${suffix}@client.test`;
  const clientId = `aaaaaaaaaaaaaaaaaaaa${String(suffix).slice(-4)}`.slice(0, 24);
  const master = await CampOpsClientMaster.create({
    clientId,
    clientName: `Scoped Client ${suffix}`,
    programName: 'Ortho',
    campName: 'BMD',
    assignedUserEmails: [assignedEmail],
  });
  t.after(async () => {
    master.isDeleted = true;
    master.deletedAt = new Date().toISOString();
    await master.save();
  });

  const scoped = await resolveCampClientScope({
    email: assignedEmail.toUpperCase(),
    roleIds: [{ permissions: [PERMISSIONS.CAMPS_APPROVE] }],
  });
  assert.ok(Array.isArray(scoped));
  assert.equal(scoped.length, 1);
  assert.equal(isClientIdInScope(scoped, clientId), true);
  assert.equal(isClientMasterInScope(scoped, master.toObject()), true);

  await assert.rejects(
    () => assertCampClientAccess(
      { email: assignedEmail, roleIds: [{ permissions: [PERMISSIONS.CAMPS_APPROVE] }] },
      { clientId, campaignType: 'Cardio', campaignName: 'BMD' },
    ),
    (err) => err instanceof AppError && err.status === 403,
  );

  await assertCampClientAccess(
    { email: assignedEmail, roleIds: [{ permissions: [PERMISSIONS.CAMPS_READ] }] },
    { clientId, campaignType: 'Ortho', campaignName: 'BMD' },
  );
});

test('resolveCampClientScope leaves unassigned approvers unrestricted', async (t) => {
  const suffix = Date.now();
  const master = await CampOpsClientMaster.create({
    clientId: `ccccccccccccccc${String(suffix).slice(-8)}`.slice(0, 24),
    clientName: `Other Client ${suffix}`,
    programName: 'Ortho',
    campName: 'BMD',
    assignedUserEmails: [`someone-${suffix}@client.test`],
  });
  t.after(async () => {
    master.isDeleted = true;
    master.deletedAt = new Date().toISOString();
    await master.save();
  });

  const scope = await resolveCampClientScope({
    email: `ops-${suffix}@tylo.test`,
    roleIds: [{ permissions: [PERMISSIONS.CAMPS_APPROVE] }],
  });
  assert.equal(scope, null);
});

test('resolveCampClientScope hides camps from unassigned non-approvers', async (t) => {
  const suffix = Date.now();
  const master = await CampOpsClientMaster.create({
    clientId: `ddddddddddddddd${String(suffix).slice(-8)}`.slice(0, 24),
    clientName: `Hidden Client ${suffix}`,
    programName: 'Ortho',
    campName: 'BMD',
    assignedUserEmails: [`owner-${suffix}@client.test`],
  });
  t.after(async () => {
    master.isDeleted = true;
    master.deletedAt = new Date().toISOString();
    await master.save();
  });

  const scope = await resolveCampClientScope({
    email: `viewer-${suffix}@client.test`,
    roleIds: [{ permissions: [PERMISSIONS.CAMPS_READ] }],
  });
  assert.ok(Array.isArray(scope));
  assert.equal(scope.length, 0);
});
