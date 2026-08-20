import { PERMISSIONS } from '../../config/constants.js';
import { ALL_PERMISSION_KEYS } from './permission.catalog.js';

export function normalizeGrantedPermissions(list) {
  if (!Array.isArray(list)) return [];
  const valid = new Set(ALL_PERMISSION_KEYS);
  return [
    ...new Set(
      list
        .map(String)
        .filter((p) => p === PERMISSIONS.ALL || valid.has(p))
    ),
  ];
}

/** Union of role permissions and per-user grants from Control Center. */
export function collectUserPermissions(user) {
  const set = new Set();
  for (const role of user?.roleIds || []) {
    for (const p of role.permissions || []) set.add(p);
  }
  for (const p of user?.grantedPermissions || []) set.add(p);
  return set;
}

export function userHasAdminAccess(user) {
  return collectUserPermissions(user).has(PERMISSIONS.ALL);
}

export function assertAccessPayload({ roleIds = [], grantedPermissions = [] }) {
  const perms = normalizeGrantedPermissions(grantedPermissions);
  const ids = [...new Set((roleIds || []).map((id) => String(id?._id || id)).filter(Boolean))];
  if (!ids.length && !perms.length) {
    return { ok: false, message: 'Assign at least one access option in Control Center' };
  }
  return { ok: true, roleIds: ids, grantedPermissions: perms };
}

function actorPermissionSet(actorPermissions) {
  if (actorPermissions instanceof Set) return actorPermissions;
  if (Array.isArray(actorPermissions)) return new Set(actorPermissions);
  return new Set();
}

function isAdminEquivalentRole(role) {
  if (!role) return false;
  if (String(role.name || '') === 'Admin') return true;
  return (role.permissions || []).includes(PERMISSIONS.ALL);
}

/**
 * Non-Admin actors may only grant permissions they already hold, and may not
 * assign Admin / `*` (global) roles or grants.
 *
 * @param {Set|string[]} actorPermissions - caller's effective permission set
 * @param {{ roleIds?: string[], grantedPermissions?: string[] }} access
 * @param {Array<{ _id: string, name?: string, permissions?: string[] }>} roleDocs
 * @returns {{ ok: true } | { ok: false, message: string, code: string }}
 */
export function assertActorMayAssignAccess(actorPermissions, access, roleDocs = []) {
  const actor = actorPermissionSet(actorPermissions);
  if (actor.has(PERMISSIONS.ALL)) return { ok: true };

  const grants = normalizeGrantedPermissions(access?.grantedPermissions || []);
  if (grants.includes(PERMISSIONS.ALL)) {
    return {
      ok: false,
      message: 'Only an Admin can grant global (*) access',
      code: 'PRIVILEGE_ESCALATION',
    };
  }
  for (const perm of grants) {
    if (!actor.has(perm)) {
      return {
        ok: false,
        message: `You cannot grant permission "${perm}" that you do not hold`,
        code: 'PRIVILEGE_ESCALATION',
      };
    }
  }

  const roleById = new Map((roleDocs || []).map((r) => [String(r._id), r]));
  for (const id of access?.roleIds || []) {
    const role = roleById.get(String(id));
    if (!role) {
      return { ok: false, message: 'One or more roles are invalid', code: 'VALIDATION_ERROR' };
    }
    if (isAdminEquivalentRole(role)) {
      return {
        ok: false,
        message: 'Only an Admin can assign the Admin role or global (*) access',
        code: 'PRIVILEGE_ESCALATION',
      };
    }
    for (const perm of role.permissions || []) {
      if (perm === PERMISSIONS.ALL) {
        return {
          ok: false,
          message: 'Only an Admin can assign the Admin role or global (*) access',
          code: 'PRIVILEGE_ESCALATION',
        };
      }
      if (!actor.has(perm)) {
        return {
          ok: false,
          message: `You cannot assign role "${role.name}" because it includes permission "${perm}" you do not hold`,
          code: 'PRIVILEGE_ESCALATION',
        };
      }
    }
  }

  return { ok: true };
}

/**
 * Non-Admin actors may only set role permissions that are a subset of their own,
 * and may never create/update a role to Admin-equivalent (*).
 */
export function assertActorMaySetRolePermissions(actorPermissions, permissions = [], { roleName } = {}) {
  const actor = actorPermissionSet(actorPermissions);
  if (actor.has(PERMISSIONS.ALL)) return { ok: true };

  const perms = normalizeGrantedPermissions(permissions);
  if (perms.includes(PERMISSIONS.ALL) || String(roleName || '') === 'Admin') {
    return {
      ok: false,
      message: 'Only an Admin can create or modify Admin-equivalent roles',
      code: 'PRIVILEGE_ESCALATION',
    };
  }
  for (const perm of perms) {
    if (!actor.has(perm)) {
      return {
        ok: false,
        message: `You cannot put permission "${perm}" on a role because you do not hold it`,
        code: 'PRIVILEGE_ESCALATION',
      };
    }
  }
  return { ok: true };
}
