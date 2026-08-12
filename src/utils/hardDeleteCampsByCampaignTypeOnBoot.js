import { CampOpsCamp } from '../modules/campOps/campOps.model.js';
import {
  clearPersistenceCache,
  getPersistenceMode,
  loadCollection,
  upsertDocument,
} from '../store/persistence.js';
import { invalidateIdIndex } from '../store/filedb.js';
import {
  campMatchesCampaignTypeExact,
  filterCampsByCampaignTypeExact,
  normalizeCampaignTypeExact,
} from './campCampaignTypeMatch.js';
import { parseCampaignTypesEnv } from './purgeAllCamps.js';

export const CAMP_OPS_COLLECTION = 'camp_ops_camps';
export const CAMP_CAMPAIGN_TYPE_FIELD = 'campaignType';
export const MONGO_COLLECTION = `tylo_${CAMP_OPS_COLLECTION}`;
export const BOOT_LOCK_COLLECTION = 'system_boot_locks';

const JOB_PREFIX = 'hard_delete_camps_campaign_type';
const RUNNING_STALE_MS = 15 * 60 * 1000;

let inProcessGuard = false;

function lockIdForType(campaignType) {
  const normalized = normalizeCampaignTypeExact(campaignType);
  return `${JOB_PREFIX}:${normalized}`;
}

function validateCampModelOrThrow() {
  if (!CampOpsCamp) {
    throw new Error('[camps-hard-delete] CampOpsCamp model is unavailable');
  }
  if (typeof CampOpsCamp.find !== 'function') {
    throw new Error('[camps-hard-delete] CampOpsCamp model is missing find()');
  }
  if (CAMP_CAMPAIGN_TYPE_FIELD !== 'campaignType') {
    throw new Error('[camps-hard-delete] campaignType field constant mismatch');
  }
  if (CAMP_OPS_COLLECTION !== 'camp_ops_camps') {
    throw new Error('[camps-hard-delete] camp_ops_camps collection constant mismatch');
  }
}

export async function readBootLock(campaignType) {
  const rows = await loadCollection(BOOT_LOCK_COLLECTION);
  return rows.find((row) => String(row._id) === lockIdForType(campaignType)) || null;
}

async function writeBootLock(doc) {
  await upsertDocument(BOOT_LOCK_COLLECTION, doc);
}

async function acquireBootLock(campaignType, { dryRun = false } = {}) {
  const id = lockIdForType(campaignType);
  const now = new Date().toISOString();
  const existing = await readBootLock(campaignType);

  if (existing?.status === 'completed') {
    return { acquired: false, reason: 'already_completed', lock: existing };
  }

  if (existing?.status === 'running') {
    const started = Date.parse(existing.startedAt || existing.updatedAt || 0);
    if (Number.isFinite(started) && Date.now() - started < RUNNING_STALE_MS) {
      return { acquired: false, reason: 'already_running', lock: existing };
    }
  }

  const lock = {
    _id: id,
    jobKey: id,
    job: JOB_PREFIX,
    campaignType: String(campaignType || '').trim(),
    campaignTypeNormalized: normalizeCampaignTypeExact(campaignType),
    collection: CAMP_OPS_COLLECTION,
    mongoCollection: MONGO_COLLECTION,
    field: CAMP_CAMPAIGN_TYPE_FIELD,
    status: dryRun ? 'dry_run' : 'running',
    dryRun: Boolean(dryRun),
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    matchingCount: null,
    deletedCount: null,
    error: null,
  };

  await writeBootLock(lock);
  return { acquired: true, lock };
}

async function completeBootLock(campaignType, patch) {
  const id = lockIdForType(campaignType);
  const existing = await readBootLock(campaignType);
  const now = new Date().toISOString();
  await writeBootLock({
    _id: id,
    ...(existing || {}),
    ...patch,
    updatedAt: now,
    completedAt: patch.completedAt ?? now,
  });
}

async function failBootLock(campaignType, error) {
  const id = lockIdForType(campaignType);
  const existing = await readBootLock(campaignType);
  const now = new Date().toISOString();
  await writeBootLock({
    _id: id,
    ...(existing || {}),
    status: 'failed',
    error: String(error?.message || error || 'unknown error'),
    updatedAt: now,
  });
}

async function hardDeleteCampIds(ids) {
  if (!ids.length) return { deletedCount: 0 };

  const rows = await loadCollection(CAMP_OPS_COLLECTION);
  const idSet = new Set(ids.map((id) => String(id)));
  const remaining = rows.filter((row) => !idSet.has(String(row._id)));
  const deletedCount = rows.length - remaining.length;

  if (getPersistenceMode() === 'mongo') {
    const mongoose = (await import('mongoose')).default;
    const db = mongoose.connection?.db;
    if (!db) throw new Error('[camps-hard-delete] MongoDB is not connected');
    const col = db.collection(MONGO_COLLECTION);
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      await col.deleteMany({ _id: { $in: slice } });
    }
    clearPersistenceCache({ keep: [BOOT_LOCK_COLLECTION] });
    invalidateIdIndex(CAMP_OPS_COLLECTION);
    return { deletedCount };
  }

  const { saveCollection } = await import('../store/persistence.js');
  await saveCollection(CAMP_OPS_COLLECTION, remaining);
  invalidateIdIndex(CAMP_OPS_COLLECTION);
  return { deletedCount };
}

/**
 * Permanently delete camps whose campaignType exactly matches targetType (trim + case fold).
 */
export async function hardDeleteCampsByCampaignTypeExact(targetType, { dryRun = false } = {}) {
  validateCampModelOrThrow();

  const normalizedTarget = normalizeCampaignTypeExact(targetType);
  if (!normalizedTarget) {
    return {
      ok: false,
      skipped: true,
      reason: 'blank_campaign_type',
      collection: CAMP_OPS_COLLECTION,
      mongoCollection: MONGO_COLLECTION,
      field: CAMP_CAMPAIGN_TYPE_FIELD,
      campaignType: targetType,
      matchingCount: 0,
      deletedCount: 0,
      dryRun,
    };
  }

  const allCamps = await CampOpsCamp.find({}).exec();
  const matching = filterCampsByCampaignTypeExact(allCamps, targetType);

  if (dryRun) {
    return {
      ok: true,
      skipped: false,
      dryRun: true,
      completed: false,
      collection: CAMP_OPS_COLLECTION,
      mongoCollection: MONGO_COLLECTION,
      field: CAMP_CAMPAIGN_TYPE_FIELD,
      campaignType: String(targetType || '').trim(),
      campaignTypeNormalized: normalizedTarget,
      matchingCount: matching.length,
      deletedCount: 0,
      sampleIds: matching.slice(0, 5).map((c) => c.campId || c._id),
    };
  }

  const ids = matching.map((c) => c._id);
  const { deletedCount } = await hardDeleteCampIds(ids);

  return {
    ok: true,
    skipped: false,
    dryRun: false,
    completed: true,
    collection: CAMP_OPS_COLLECTION,
    mongoCollection: MONGO_COLLECTION,
    field: CAMP_CAMPAIGN_TYPE_FIELD,
    campaignType: String(targetType || '').trim(),
    campaignTypeNormalized: normalizedTarget,
    matchingCount: matching.length,
    deletedCount,
  };
}

/**
 * Boot entry: PURGE_CAMPS_BY_CAMPAIGN_TYPE_ON_BOOT=MOM
 * Optional dry-run: PURGE_CAMPS_BY_CAMPAIGN_TYPE_ON_BOOT_DRY_RUN=true
 */
export async function maybeHardDeleteCampsByCampaignTypeOnBoot() {
  const raw = String(process.env.PURGE_CAMPS_BY_CAMPAIGN_TYPE_ON_BOOT || '').trim();
  if (!raw || raw.toLowerCase() === 'false') return null;

  const dryRun = String(process.env.PURGE_CAMPS_BY_CAMPAIGN_TYPE_ON_BOOT_DRY_RUN || '').toLowerCase() === 'true';
  const campaignTypes = parseCampaignTypesEnv(raw);
  if (!campaignTypes.length) return null;

  if (inProcessGuard) {
    console.warn('[camps-hard-delete] Skipped — purge already running in this process');
    return { skipped: true, reason: 'in_process_guard' };
  }

  inProcessGuard = true;
  const results = [];

  try {
    validateCampModelOrThrow();

    for (const campaignType of campaignTypes) {
      const lockResult = await acquireBootLock(campaignType, { dryRun });
      if (!lockResult.acquired) {
        console.warn('[camps-hard-delete] Skipped — lock not acquired:', {
          campaignType,
          reason: lockResult.reason,
          lock: lockResult.lock,
        });
        results.push({
          campaignType,
          skipped: true,
          reason: lockResult.reason,
          lock: lockResult.lock,
        });
        continue;
      }

      try {
        const result = await hardDeleteCampsByCampaignTypeExact(campaignType, { dryRun });
        console.warn('[camps-hard-delete] Boot purge result:', result);

        if (!dryRun && result.ok) {
          await completeBootLock(campaignType, {
            status: 'completed',
            dryRun: false,
            matchingCount: result.matchingCount,
            deletedCount: result.deletedCount,
            completedAt: new Date().toISOString(),
            error: null,
          });
        }

        results.push(result);
      } catch (err) {
        await failBootLock(campaignType, err);
        console.error('[camps-hard-delete] Boot purge failed:', err.message);
        results.push({
          campaignType,
          ok: false,
          error: err.message,
        });
      }
    }

    if (!dryRun) {
      console.warn('[camps-hard-delete] Clear PURGE_CAMPS_BY_CAMPAIGN_TYPE_ON_BOOT after this deploy');
    } else {
      console.warn('[camps-hard-delete] Dry-run only — no documents deleted, completion lock not set');
    }

    return results;
  } finally {
    inProcessGuard = false;
  }
}

/** @internal test helper */
export function __testCampMatches(camp, targetType) {
  return campMatchesCampaignTypeExact(camp, targetType);
}
