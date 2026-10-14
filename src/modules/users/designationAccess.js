import { ROLE_PERMISSIONS } from '../../config/constants.js';

/** Keep in sync with ROLE_PERMISSIONS['Camp Coordinator'] (seed overwrites this role). */
export const CAMP_COORDINATOR_PERMISSIONS = [...ROLE_PERMISSIONS['Camp Coordinator']];

export const DESIGNATION_ACCESS_TEMPLATES = {
  'healthcare camp coordinator': {
    roleNames: ['Camp Coordinator'],
    summary:
      'Document One, Camp One (incl. Confirm / Hold / Unhold / Submit to Finance One), Request One, Operations Dashboard & Notifications, and Verification One.',
    modules: [
      { moduleId: 'agreements', access: 'All' },
      { moduleId: 'camps', access: 'All' },
      { moduleId: 'assetRequests', access: 'View, Request' },
      { moduleId: 'platform', access: 'All' },
      { moduleId: 'verifications', access: 'Viewer' },
      { moduleId: 'finance', access: 'View, Add' },
    ],
  },
};

export function normalizeDesignationKey(designation) {
  return String(designation || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function getDesignationAccessTemplate(designation) {
  return DESIGNATION_ACCESS_TEMPLATES[normalizeDesignationKey(designation)] || null;
}

export function hasDesignationAccessTemplate(designation) {
  return Boolean(getDesignationAccessTemplate(designation));
}

export function designationRoleNames(designation) {
  return getDesignationAccessTemplate(designation)?.roleNames || [];
}

export async function resolveDesignationRoleIds(designation, Role) {
  const template = getDesignationAccessTemplate(designation);
  if (!template) return null;
  const roles = await Role.find({ isDeleted: false });
  const byName = new Map(roles.map((r) => [r.name, r]));
  const ids = [];
  for (const name of template.roleNames) {
    const role = byName.get(name);
    if (!role) {
      throw new Error(`Role "${name}" is missing — restart the server to seed designation roles`);
    }
    ids.push(String(role._id));
  }
  return [...new Set(ids)];
}

/** Align users with designation-based access bundles (e.g. Healthcare Camp Coordinator). */
export async function applyDesignationAccessRoles(User, Role) {
  const users = await User.find({ isDeleted: false });
  let updated = 0;
  for (const user of users) {
    if (!hasDesignationAccessTemplate(user.designation)) continue;
    const ids = await resolveDesignationRoleIds(user.designation, Role);
    if (!ids?.length) continue;
    const current = [...new Set((user.roleIds || []).map((id) => String(id?._id || id)).filter(Boolean))].sort();
    const next = [...ids].sort();
    if (current.join('|') !== next.join('|')) {
      user.roleIds = ids;
      await user.save();
      updated += 1;
    }
  }
  if (updated) {
    console.log(`[roles] Applied designation access for ${updated} user(s)`);
  }
  return updated;
}
