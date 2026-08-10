import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAssignedUserEmails,
  applyClientScopeToFilter,
  applyClientScopeToIdField,
  isClientIdInScope,
  resolveCampClientScope,
  assertCampClientAccess,
} from './campOps.clientAccess.js';
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
  const scoped = new Set(['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb']);
  assert.deepEqual(
    applyClientScopeToFilter({ isDeleted: false }, scoped),
    { isDeleted: false, clientId: { $in: [...scoped] } },
  );
  assert.equal(
    applyClientScopeToFilter({ isDeleted: false, clientId: 'cccccccccccccccccccccccc' }, scoped).clientId,
    '__none__',
  );
  assert.deepEqual(
    applyClientScopeToFilter({ isDeleted: false, clientId: 'AAAAAAAAAAAAAAAAaaaaaaaa' }, scoped),
    { isDeleted: false, clientId: 'AAAAAAAAAAAAAAAAaaaaaaaa' },
  );
  assert.equal(applyClientScopeToFilter({ isDeleted: false }, new Set()).clientId, '__none__');
  assert.deepEqual(applyClientScopeToFilter({ isDeleted: false }, null), { isDeleted: false });
});

test('applyClientScopeToIdField scopes brand _id lists', () => {
  const scoped = new Set(['aaaaaaaaaaaaaaaaaaaaaaaa']);
  assert.deepEqual(
    applyClientScopeToIdField({ isDeleted: false }, scoped, '_id'),
    { isDeleted: false, _id: { $in: ['aaaaaaaaaaaaaaaaaaaaaaaa'] } },
  );
});

test('isClientIdInScope compares hex ids case-insensitively', () => {
  const scoped = new Set(['aaaaaaaaaaaaaaaaaaaaaaaa']);
  assert.equal(isClientIdInScope(null, 'anything'), true);
  assert.equal(isClientIdInScope(scoped, 'AAAAAAAAAAAAAAAAaaaaaaaa'), true);
  assert.equal(isClientIdInScope(scoped, 'bbbbbbbbbbbbbbbbbbbbbbbb'), false);
});

test('resolveCampClientScope scopes listed users even with camps:approve', async (t) => {
  const suffix = Date.now();
  const assignedEmail = `assigned-${suffix}@client.test`;
  const clientId = `aaaaaaaaaaaaaaaaaaaa${String(suffix).slice(-4)}`.slice(0, 24);
  const master = await CampOpsClientMaster.create({
    clientId,
    clientName: `Scoped Client ${suffix}`,
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
  assert.ok(scoped instanceof Set);
  assert.equal(scoped.size, 1);
  assert.equal(isClientIdInScope(scoped, clientId), true);

  await assert.rejects(
    () => assertCampClientAccess(
      { email: assignedEmail, roleIds: [{ permissions: [PERMISSIONS.CAMPS_APPROVE] }] },
      { clientId: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
    ),
    (err) => err instanceof AppError && err.status === 403,
  );

  await assertCampClientAccess(
    { email: assignedEmail, roleIds: [{ permissions: [PERMISSIONS.CAMPS_READ] }] },
    { clientId },
  );
});

test('resolveCampClientScope leaves unassigned approvers unrestricted', async (t) => {
  const suffix = Date.now();
  const master = await CampOpsClientMaster.create({
    clientId: `ccccccccccccccc${String(suffix).slice(-8)}`.slice(0, 24),
    clientName: `Other Client ${suffix}`,
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
  assert.ok(scope instanceof Set);
  assert.equal(scope.size, 0);
});
