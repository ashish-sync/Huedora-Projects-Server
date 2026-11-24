/** Platform-level access tier shown in Access Control (independent of RBAC roleIds). */
export const SYSTEM_ROLES = ['Super Admin', 'Admin', 'User'];

const SYSTEM_ROLE_SET = new Set(SYSTEM_ROLES);

/**
 * Designation → System Role for backfill when systemRole is empty.
 * After the org rename, Ops Support Team / Manager titles are not forced here so
 * migrated people keep the platform tier they already had.
 */
const DESIGNATION_SYSTEM_ROLE = {
  'team leader': 'Admin',
  'business head': 'Super Admin',
  'healthcare camp coordinator': 'User',
  'ops support team': 'User',
  // Legacy titles (pre-rename) — kept so empty systemRole still backfills.
  'operations leader': 'Admin',
  'system analyst': 'Admin',
  'lead - process & tech': 'Super Admin',
  'senior manager': 'Super Admin',
  'data analyst': 'User',
  'individual contributor': 'User',
  'logistics associate': 'User',
  'training manager': 'User',
  'team lead': 'Admin',
};

export function normalizeSystemRoleKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ');
}

export function normalizeSystemRole(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = SYSTEM_ROLES.find((role) => normalizeSystemRoleKey(role) === normalizeSystemRoleKey(raw));
  return match || '';
}

export function systemRoleFromDesignation(designation) {
  const key = normalizeSystemRoleKey(designation);
  return DESIGNATION_SYSTEM_ROLE[key] || '';
}

export function resolveSystemRole({ systemRole, designation, fallback = '' } = {}) {
  const explicit = normalizeSystemRole(systemRole);
  if (explicit) return explicit;
  const fromDesignation = systemRoleFromDesignation(designation);
  if (fromDesignation) return fromDesignation;
  return normalizeSystemRole(fallback) || '';
}

/**
 * Backfill empty systemRole from designation only.
 * Never overwrite an existing platform tier (protects designation renames).
 */
export async function applySystemRolesFromDesignation(User) {
  const users = await User.find({ isDeleted: false });
  let updated = 0;
  for (const user of users) {
    const current = normalizeSystemRole(user.systemRole);
    if (current) continue;
    const mapped = systemRoleFromDesignation(user.designation);
    if (!mapped) continue;
    user.systemRole = mapped;
    await user.save();
    updated += 1;
  }
  if (updated) {
    console.log(`[users] Applied system role from designation for ${updated} user(s)`);
  }
  return updated;
}

/** Platform Super Admin (systemRole), independent of RBAC `*`. */
export function userIsSuperAdmin(user) {
  return normalizeSystemRole(user?.systemRole) === 'Super Admin';
}

/**
 * Record delete power: RBAC Admin (`*`) or platform Super Admin.
 * Used for Contact Directory and Document One destructive actions.
 */
export function userCanDeleteRecords(user, permissions) {
  if (permissions instanceof Set) {
    if (permissions.has('*')) return true;
  } else if (Array.isArray(permissions) && permissions.includes('*')) {
    return true;
  } else if (permissions?.has?.('*')) {
    return true;
  }
  return userIsSuperAdmin(user);
}

export function assertValidSystemRole(value, { required = false } = {}) {
  const normalized = normalizeSystemRole(value);
  if (!normalized) {
    if (required) {
      return { ok: false, message: 'System role is required' };
    }
    return { ok: true, value: '' };
  }
  if (!SYSTEM_ROLE_SET.has(normalized)) {
    return { ok: false, message: `System role must be one of: ${SYSTEM_ROLES.join(', ')}` };
  }
  return { ok: true, value: normalized };
}
