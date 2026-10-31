/**
 * Recipient expansion / scoping for Notification Center.
 * Keep inbox rows per-user; managers get their own copy when opted in.
 */

import {
  isInManagerChain,
  resolveManagerChainIds,
} from '../users/user.hierarchy.js';

function dedupeIds(ids = []) {
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const s = String(id || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Append reporting managers for each primary recipient.
 * @param {'direct'|'chain'|true|false} mode
 */
export async function expandWithReportingManagers(recipientIds = [], mode = 'chain') {
  if (!mode) return dedupeIds(recipientIds);
  const depth = mode === 'direct' ? 1 : 16;
  const extras = [];
  for (const id of dedupeIds(recipientIds)) {
    const chain = await resolveManagerChainIds(id, { maxDepth: depth });
    if (mode === 'direct') {
      if (chain[0]) extras.push(chain[0]);
    } else {
      extras.push(...chain);
    }
  }
  return dedupeIds([...recipientIds, ...extras]);
}

/**
 * Keep only approvers who manage the subject (in reporting chain) or are platform admins.
 * Never fall back to every Approver in the tenant.
 */
export async function scopeApproversToSubjectManagers(
  approverUsers = [],
  subjectUserId,
  { isPlatformAdmin = (user) => false } = {}
) {
  const subjectId = String(subjectUserId || '').trim();
  if (!subjectId || !approverUsers.length) return approverUsers;

  const managerChain = await resolveManagerChainIds(subjectId);
  const scoped = [];
  for (const user of approverUsers) {
    const uid = String(user?._id || user?.id || '');
    if (!uid) continue;
    if (isPlatformAdmin(user)) {
      scoped.push(user);
      continue;
    }
    if (managerChain.includes(uid) || (await isInManagerChain(uid, subjectId))) {
      scoped.push(user);
    }
  }

  if (scoped.length) return scoped;
  return approverUsers.filter((user) => isPlatformAdmin(user));
}
