import { CampOpsCamp } from '../modules/campOps/campOps.model.js';

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeClientNames(clientNames = []) {
  return [...new Set(
    (Array.isArray(clientNames) ? clientNames : [clientNames])
      .map((name) => String(name || '').trim())
      .filter(Boolean),
  )];
}

function normalizeCampaignTypes(campaignTypes = []) {
  const list = Array.isArray(campaignTypes)
    ? campaignTypes
    : String(campaignTypes || '').split(/[,|]/);
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const name = String(raw || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Public alias for route/boot input normalization. */
export function normalizeCampaignTypesInput(campaignTypes = []) {
  return normalizeCampaignTypes(campaignTypes);
}

function clientNameFilter(clientNames = []) {
  const names = normalizeClientNames(clientNames);
  if (!names.length) return null;
  return {
    isDeleted: false,
    $or: names.map((name) => ({
      clientName: new RegExp(`^${escapeRegex(name)}$`, 'i'),
    })),
  };
}

function campaignTypeFilter(campaignTypes = []) {
  const types = normalizeCampaignTypes(campaignTypes);
  if (!types.length) return null;
  return {
    isDeleted: false,
    $or: types.map((type) => ({
      campaignType: new RegExp(`^${escapeRegex(type)}$`, 'i'),
    })),
  };
}

/**
 * Soft-delete Camp One camps whose clientName matches any of the given names.
 */
export async function purgeCampsByClientNames(clientNames = [], { actorId = null } = {}) {
  const filter = clientNameFilter(clientNames);
  if (!filter) {
    return { purged: 0, remaining: 0, matched: 0, clientNames: [] };
  }

  const matched = await CampOpsCamp.countDocuments(filter);
  if (!matched) {
    return {
      purged: 0,
      remaining: 0,
      matched: 0,
      clientNames: normalizeClientNames(clientNames),
    };
  }

  const now = new Date().toISOString();
  await CampOpsCamp.updateMany(filter, {
    $set: {
      isDeleted: true,
      deletedAt: now,
      deletedBy: actorId ? String(actorId) : null,
    },
  });

  const remaining = await CampOpsCamp.countDocuments(filter);
  return {
    purged: matched - remaining,
    remaining,
    matched,
    clientNames: normalizeClientNames(clientNames),
  };
}

export async function countCampsByClientNames(clientNames = []) {
  const filter = clientNameFilter(clientNames);
  if (!filter) return { total: 0, byClient: {}, samples: [] };

  const camps = await CampOpsCamp.find(filter);
  const byClient = {};
  for (const camp of camps) {
    const key = String(camp.clientName || '').trim() || '(blank)';
    byClient[key] = (byClient[key] || 0) + 1;
  }

  return {
    total: camps.length,
    byClient,
    samples: camps.slice(0, 10).map((camp) => ({
      campId: camp.campId || null,
      clientName: camp.clientName || null,
      campaignType: camp.campaignType || null,
      campaignName: camp.campaignName || null,
      lifecycleStage: camp.lifecycleStage || null,
      status: camp.status || null,
    })),
  };
}

/**
 * Soft-delete Camp One camps whose Division/Therapy (campaignType) matches.
 */
export async function purgeCampsByCampaignTypes(campaignTypes = [], { actorId = null } = {}) {
  const filter = campaignTypeFilter(campaignTypes);
  if (!filter) {
    return { purged: 0, remaining: 0, matched: 0, campaignTypes: [] };
  }

  const matched = await CampOpsCamp.countDocuments(filter);
  if (!matched) {
    return {
      purged: 0,
      remaining: 0,
      matched: 0,
      campaignTypes: normalizeCampaignTypes(campaignTypes),
    };
  }

  const now = new Date().toISOString();
  await CampOpsCamp.updateMany(filter, {
    $set: {
      isDeleted: true,
      deletedAt: now,
      deletedBy: actorId ? String(actorId) : null,
    },
  });

  const remaining = await CampOpsCamp.countDocuments(filter);
  return {
    purged: matched - remaining,
    remaining,
    matched,
    campaignTypes: normalizeCampaignTypes(campaignTypes),
  };
}

export async function countCampsByCampaignTypes(campaignTypes = []) {
  const filter = campaignTypeFilter(campaignTypes);
  if (!filter) return { total: 0, byCampaignType: {}, samples: [] };

  const camps = await CampOpsCamp.find(filter);
  const byCampaignType = {};
  for (const camp of camps) {
    const key = String(camp.campaignType || '').trim() || '(blank)';
    byCampaignType[key] = (byCampaignType[key] || 0) + 1;
  }

  return {
    total: camps.length,
    byCampaignType,
    samples: camps.slice(0, 10).map((camp) => ({
      campId: camp.campId || null,
      clientName: camp.clientName || null,
      campaignType: camp.campaignType || null,
      campaignName: camp.campaignName || null,
      lifecycleStage: camp.lifecycleStage || null,
      status: camp.status || null,
    })),
  };
}

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

/** Parse boot env like `MOM` or `MOM,Oncology` into a clean list. */
export function parseCampaignTypesEnv(raw = '') {
  return normalizeCampaignTypes(String(raw || '').split(/[,|]/));
}
