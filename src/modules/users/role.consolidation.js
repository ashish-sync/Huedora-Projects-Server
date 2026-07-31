import { Role } from './role.model.js';
import { User } from './user.model.js';
import { normalizeEmail } from '../../utils/identityNormalize.js';

/** Canonical TYLO One roles shown in Roles & Permissions. */
export const STANDARD_ROLE_NAMES = ['Admin', 'Viewer', 'Requester', 'Editor', 'Approver'];

const ROLE_DESCRIPTIONS = {
  Admin: 'Full access to all modules and settings',
  Viewer: 'Read-only access across modules',
  Requester: 'View modules and submit requests',
  Editor: 'View and edit records across modules',
  Approver: 'View modules and approve requests',
  'Camp Coordinator':
    'Healthcare Camp Coordinator — Document One, Camp One, Request One, dashboard, and Verification One',
};

/**
 * Legacy roles replaced by the standard set. Values are standard role name(s) per user.
 * Admin, Viewer, and Approver keep the same name.
 */
export const LEGACY_ROLE_MIGRATION = {
  AssetManager: ['Editor'],
  Verifier: ['Editor'],
  CampRequester: ['Requester'],
  CampApprover: ['Approver'],
  'Tylo Full Access': ['Editor', 'Approver'],
  'Tylo Camp Coordinator': ['Editor'],
  'Tylo Logistics Associate': ['Editor', 'Approver'],
};

const DEPRECATED_ROLE_NAMES = [
  'AssetManager',
  'Verifier',
  'CampRequester',
  'CampApprover',
  'Tylo Full Access',
  'Tylo Camp Coordinator',
  'Tylo Logistics Associate',
];

export function roleDescription(name) {
  return ROLE_DESCRIPTIONS[name] || `${name} role`;
}

function normalizeRoleId(id) {
  if (!id) return '';
  if (typeof id === 'object') return String(id._id || '');
  return String(id);
}

/**
 * One-time-safe migration: remap users off deprecated roles and hide legacy roles.
 */
export async function consolidateLegacyRoles() {
  const roles = await Role.find({});
  const roleByName = new Map();
  for (const role of roles) {
    if (!role.isDeleted) roleByName.set(role.name, role);
  }

  const standardIds = new Map();
  for (const name of STANDARD_ROLE_NAMES) {
    const role = roleByName.get(name);
    if (role) standardIds.set(name, String(role._id));
  }

  let usersUpdated = 0;
  const users = await User.find({ isDeleted: false });
  for (const user of users) {
    const currentIds = (user.roleIds || []).map(normalizeRoleId).filter(Boolean);
    const nextIds = [];
    let changed = false;

    for (const roleId of currentIds) {
      const role = roles.find((r) => String(r._id) === roleId);
      if (!role || role.isDeleted) {
        changed = true;
        continue;
      }
      const mapped = LEGACY_ROLE_MIGRATION[role.name];
      if (mapped) {
        changed = true;
        for (const targetName of mapped) {
          const targetId = standardIds.get(targetName);
          if (targetId) nextIds.push(targetId);
        }
        continue;
      }
      if (STANDARD_ROLE_NAMES.includes(role.name)) {
        nextIds.push(String(role._id));
      } else {
        changed = true;
      }
    }

    const deduped = [...new Set(nextIds)];
    if (!deduped.length) {
      const fallback = standardIds.get('Viewer');
      if (fallback) deduped.push(fallback);
      changed = true;
    }

    if (changed || deduped.join('|') !== currentIds.join('|')) {
      user.roleIds = deduped;
      await user.save();
      usersUpdated += 1;
    }
  }

  let rolesRetired = 0;
  for (const name of DEPRECATED_ROLE_NAMES) {
    const role = roles.find((r) => r.name === name && !r.isDeleted);
    if (!role) continue;
    role.isDeleted = true;
    role.deletedAt = new Date().toISOString();
    await role.save();
    rolesRetired += 1;
  }

  if (usersUpdated || rolesRetired) {
    console.log(
      `[roles] Consolidated legacy roles: ${usersUpdated} user(s) remapped, ${rolesRetired} role(s) retired`
    );
  }

  return { usersUpdated, rolesRetired };
}

/** Remove duplicate active accounts that share the same email (e.g. parallel seed races). */
export async function dedupeActiveUsersByEmail() {
  const users = await User.find({ isDeleted: false });
  const byEmail = new Map();

  for (const user of users) {
    const key = normalizeEmail(user.email);
    if (!key) continue;
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(user);
  }

  let removed = 0;
  for (const group of byEmail.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => {
      const loginA = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
      const loginB = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
      if (loginB !== loginA) return loginB - loginA;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    const [, ...dupes] = group;
    for (const dupe of dupes) {
      dupe.isDeleted = true;
      dupe.isActive = false;
      dupe.deletedAt = new Date().toISOString();
      dupe.tokenVersion = (dupe.tokenVersion || 0) + 1;
      await dupe.save();
      removed += 1;
    }
  }

  if (removed) {
    console.log(`[users] Removed ${removed} duplicate account(s) with the same email`);
  }
  return removed;
}
