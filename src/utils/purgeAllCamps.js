import { CampOpsCamp } from '../modules/campOps/campOps.model.js';

/**
 * Soft-delete every Camp One camp across all lifecycle stages.
 * Manage Camps only lists isDeleted:false rows, so they disappear from every stage tab.
 */
export async function purgeAllCamps({ actorId = null } = {}) {
  const before = await CampOpsCamp.countDocuments({ isDeleted: false });
  if (!before) {
    return { purged: 0, remaining: 0 };
  }

  const now = new Date().toISOString();
  await CampOpsCamp.updateMany(
    { isDeleted: false },
    {
      $set: {
        isDeleted: true,
        deletedAt: now,
        deletedBy: actorId ? String(actorId) : null,
      },
    },
  );

  const remaining = await CampOpsCamp.countDocuments({ isDeleted: false });
  return { purged: before - remaining, remaining, totalBefore: before };
}
