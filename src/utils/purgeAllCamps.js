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

/**
 * Soft-delete one camp by Mongo _id or campId (e.g. 26-08-0002).
 */
export async function purgeCampByKey(key, { actorId = null } = {}) {
  const needle = String(key || '').trim();
  if (!needle) {
    return { purged: 0, camp: null };
  }

  const camp = await CampOpsCamp.findOne({
    isDeleted: false,
    $or: [{ _id: needle }, { campId: needle }],
  });
  if (!camp) {
    return { purged: 0, camp: null };
  }

  const now = new Date().toISOString();
  camp.isDeleted = true;
  camp.deletedAt = now;
  camp.deletedBy = actorId ? String(actorId) : null;
  await camp.save();

  return {
    purged: 1,
    camp: {
      _id: String(camp._id),
      campId: camp.campId || null,
      clientName: camp.clientName || null,
      campaignName: camp.campaignName || null,
      campaignType: camp.campaignType || null,
      campDate: camp.campDate || null,
    },
  };
}
