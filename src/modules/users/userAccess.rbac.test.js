import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS } from '../../config/constants.js';
import {
  assertActorMayAssignAccess,
  assertActorMaySetRolePermissions,
  normalizeGrantedPermissions,
} from './userAccess.js';

const EDITOR = new Set(['users:write', 'users:read', 'camps:read', 'assets:read']);
const ADMIN = new Set([PERMISSIONS.ALL]);

const roles = [
  { _id: 'r-admin', name: 'Admin', permissions: [PERMISSIONS.ALL] },
  { _id: 'r-viewer', name: 'Viewer', permissions: ['camps:read'] },
  { _id: 'r-finance', name: 'Finance Lead', permissions: ['finance:write', 'finance:read'] },
  { _id: 'r-editor', name: 'Editor', permissions: ['users:write', 'users:read', 'camps:read'] },
];

test('Admin may grant * and Admin role', () => {
  assert.equal(
    assertActorMayAssignAccess(ADMIN, { roleIds: ['r-admin'], grantedPermissions: ['*'] }, roles).ok,
    true
  );
});

test('USERS_WRITE without * cannot grant global *', () => {
  const result = assertActorMayAssignAccess(
    EDITOR,
    { roleIds: ['r-viewer'], grantedPermissions: ['*'] },
    roles
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PRIVILEGE_ESCALATION');
});

test('USERS_WRITE without * cannot assign Admin role', () => {
  const result = assertActorMayAssignAccess(EDITOR, { roleIds: ['r-admin'], grantedPermissions: [] }, roles);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PRIVILEGE_ESCALATION');
});

test('USERS_WRITE without * cannot grant permissions they do not hold', () => {
  const result = assertActorMayAssignAccess(
    EDITOR,
    { roleIds: [], grantedPermissions: ['finance:write'] },
    roles
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PRIVILEGE_ESCALATION');
});

test('USERS_WRITE without * cannot assign a role with permissions they lack', () => {
  const result = assertActorMayAssignAccess(
    EDITOR,
    { roleIds: ['r-finance'], grantedPermissions: [] },
    roles
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PRIVILEGE_ESCALATION');
});

test('USERS_WRITE may assign roles/grants within their own authority', () => {
  const result = assertActorMayAssignAccess(
    EDITOR,
    { roleIds: ['r-editor'], grantedPermissions: ['camps:read'] },
    roles
  );
  assert.equal(result.ok, true);
});

test('USERS_WRITE cannot create Admin-equivalent role', () => {
  const result = assertActorMaySetRolePermissions(EDITOR, ['*'], { roleName: 'SuperUser' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PRIVILEGE_ESCALATION');
});

test('USERS_WRITE cannot put foreign permissions on a role', () => {
  const result = assertActorMaySetRolePermissions(EDITOR, ['finance:write'], { roleName: 'Custom' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PRIVILEGE_ESCALATION');
});

test('USERS_WRITE may create a role with subset of their permissions', () => {
  const result = assertActorMaySetRolePermissions(EDITOR, ['users:read', 'camps:read'], {
    roleName: 'Limited',
  });
  assert.equal(result.ok, true);
});

test('Admin may create Admin-equivalent role permissions', () => {
  assert.equal(assertActorMaySetRolePermissions(ADMIN, ['*'], { roleName: 'Admin' }).ok, true);
});

test('normalizeGrantedPermissions keeps catalog keys and *', () => {
  const out = normalizeGrantedPermissions(['users:write', '*', 'not-a-real-perm', 'camps:read']);
  assert.deepEqual(out.sort(), ['*', 'camps:read', 'users:write'].sort());
});
