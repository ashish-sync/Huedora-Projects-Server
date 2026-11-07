/** Platform-level access tier shown in Access Control (independent of RBAC roleIds). */
export const SYSTEM_ROLES = ['Super Admin', 'Admin', 'User'];

const SYSTEM_ROLE_SET = new Set(SYSTEM_ROLES);

/** Designation → System Role for backfill of existing people. */
const DESIGNATION_SYSTEM_ROLE = {
  'operations leader': 'Admin',
  'system analyst': 'Admin',
  'team leader': 'Admin',
  'business head': 'Super Admin',
  'lead - process & tech': 'Super Admin',
  'senior manager': 'Super Admin',
  'data analyst': 'User',
  'healthcare camp coordinator': 'User',
  'individual contributor': 'User',
  'logistics associate': 'User',
  'training manager': 'User',
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

/** Backfill systemRole from designation for existing users (idempotent). */
export async function applySystemRolesFromDesignation(User) {
  const users = await User.find({ isDeleted: false });
  let updated = 0;
  for (const user of users) {
    const mapped = systemRoleFromDesignation(user.designation);
    if (!mapped) continue;
    const current = normalizeSystemRole(user.systemRole);
    if (current === mapped) continue;
    user.systemRole = mapped;
    await user.save();
    updated += 1;
  }
  if (updated) {
    console.log(`[users] Applied system role from designation for ${updated} user(s)`);
  }
  return updated;
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
