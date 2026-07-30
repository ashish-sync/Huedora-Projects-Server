import { Role } from '../modules/users/role.model.js';
import { expandImplications } from './permission.implications.js';

let roleIndexCache = { at: 0, map: null };
const ROLE_INDEX_TTL_MS = 60_000;

export function invalidateRoleIndexCache() {
  roleIndexCache = { at: 0, map: null };
}

export async function buildRoleIndex() {
  if (roleIndexCache.map && Date.now() - roleIndexCache.at < ROLE_INDEX_TTL_MS) {
    return roleIndexCache.map;
  }
  const roles = await Role.find({ isDeleted: false });
  const map = new Map(roles.map((role) => [String(role._id), role]));
  roleIndexCache = { at: Date.now(), map };
  return map;
}

/**
 * Collect direct + inherited permissions for one role (parent chain).
 */
export function collectRolePermissions(role, roleById, visiting = new Set()) {
  if (!role) return [];
  const id = String(role._id || role);
  if (visiting.has(id)) return [];
  visiting.add(id);

  let permissions = [...(role.permissions || [])];
  if (role.parentRoleId) {
    const parent = roleById.get(String(role.parentRoleId));
    if (parent) {
      permissions = [...collectRolePermissions(parent, roleById, visiting), ...permissions];
    }
  }

  visiting.delete(id);
  return permissions;
}

export function resolveEffectivePermissions(user, roleById) {
  const union = new Set();
  for (const role of user?.roleIds || []) {
    const roleDoc = roleById.get(String(role._id || role)) || role;
    for (const permission of collectRolePermissions(roleDoc, roleById)) {
      union.add(permission);
    }
  }
  return expandImplications(union);
}

export async function resolveEffectivePermissionsForUser(user) {
  const roleById = await buildRoleIndex();
  return resolveEffectivePermissions(user, roleById);
}

export function assertNoParentCycle(roleId, parentRoleId, roleById) {
  if (!parentRoleId) return;
  const target = String(roleId);
  const parentId = String(parentRoleId);
  if (target === parentId) {
    throw new Error('A role cannot inherit from itself');
  }
  const visiting = new Set([target]);
  let cursor = roleById.get(parentId);
  while (cursor) {
    const id = String(cursor._id);
    if (visiting.has(id)) {
      throw new Error('Role inheritance cycle detected');
    }
    visiting.add(id);
    if (!cursor.parentRoleId) break;
    cursor = roleById.get(String(cursor.parentRoleId));
  }
}
