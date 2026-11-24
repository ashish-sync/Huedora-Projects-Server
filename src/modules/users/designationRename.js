/**
 * Canonical old → new designation titles (org rename).
 * Keep aliases in access/approval matchers so transitional rows still work
 * until every user has been migrated.
 *
 * Locked picklist: Business Head, Camp Coordinator, Ops. Manager,
 * Ops. Support Team, Team Leader.
 */

export const DESIGNATION_RENAME_MAP = Object.freeze({
  // → Ops. Support Team
  accounts: 'Ops. Support Team',
  'data analyst': 'Ops. Support Team',
  'individual contributor': 'Ops. Support Team',
  'logistics associate': 'Ops. Support Team',
  'system analyst': 'Ops. Support Team',
  'training manager': 'Ops. Support Team',
  'ops support team': 'Ops. Support Team',

  // → Ops. Manager
  'lead - process & tech': 'Ops. Manager',
  'lead – process & tech': 'Ops. Manager',
  'lead — process & tech': 'Ops. Manager',
  'operations leader': 'Ops. Manager',
  'senior manager': 'Ops. Manager',
  manager: 'Ops. Manager',
  'operations manager': 'Ops. Manager',
  'operations head': 'Ops. Manager',
  'product manager': 'Ops. Manager',
  'senior team lead': 'Ops. Manager',

  // → Camp Coordinator (Healthcare Camp Coordinator is the same title)
  'healthcare camp coordinator': 'Camp Coordinator',

  // → Team Leader
  'team lead': 'Team Leader',

  // → Business Head (legacy senior titles)
  director: 'Business Head',
  'vice president': 'Business Head',
  'head of department': 'Business Head',
});

export function normalizeDesignationRenameKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\s+/g, ' ');
}

/** Resolve the post-rename title, or the original trimmed value when unchanged. */
export function resolveRenamedDesignation(designation) {
  const raw = String(designation || '').trim();
  if (!raw) return '';
  const mapped = DESIGNATION_RENAME_MAP[normalizeDesignationRenameKey(raw)];
  return mapped || raw;
}

/**
 * Rewrite stored user.designation values. Idempotent.
 * Does not touch systemRole — platform tier stays with the person.
 */
export async function applyDesignationRenames(User) {
  const users = await User.find({ isDeleted: false });
  let updated = 0;
  for (const user of users) {
    const current = String(user.designation || '').trim();
    if (!current) continue;
    const next = resolveRenamedDesignation(current);
    if (next === current) continue;
    user.designation = next;
    await user.save();
    updated += 1;
  }
  if (updated) {
    console.log(`[users] Renamed designation for ${updated} user(s)`);
  }
  return updated;
}
