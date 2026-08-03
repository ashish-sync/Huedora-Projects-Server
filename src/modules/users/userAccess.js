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
