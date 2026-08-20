import { loadCollection, upsertDocument } from '../store/persistence.js';
import {
  attachDuplicateKey,
  buildCampDuplicateKey,
} from '../modules/campOps/campDuplicate.js';
import { isDateFieldToken } from '../modules/templates/docxPlaceholders.js';

const DUP_LOCK_ID = 'recompute_camp_duplicate_keys:v2';
const TPL_LOCK_ID = 'refresh_doc_template_date_placeholders:v1';

function campCreatedMs(camp) {
  const t = Date.parse(camp?.createdAt || camp?.updatedAt || 0);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Recompute canonical duplicateKey for all active camps (time/doctor/division normalize).
 * True collisions under the new key keep the oldest row's key; later rows clear duplicateKey
 * (field-level matching still blocks creates; unique index stays valid).
 */
export async function recomputeCampDuplicateKeys({ dryRun = false } = {}) {
  const camps = await loadCollection('camp_ops_camps');
  const active = camps.filter((row) => !row?.isDeleted);
  const byKey = new Map();
  let clearedIncomplete = 0;
  let updated = 0;
  let collisionCleared = 0;

  for (const camp of active) {
    const key = buildCampDuplicateKey({
      clientId: camp.clientId,
      clientName: camp.clientName,
      doctorName: camp.doctorName,
      campaignType: camp.campaignType,
      campDate: camp.campDate,
      startTime: camp.startTime,
    });
    if (!key) {
      if (camp.duplicateKey) {
        clearedIncomplete += 1;
        if (!dryRun) {
          delete camp.duplicateKey;
          await upsertDocument('camp_ops_camps', camp);
        }
      }
      continue;
    }
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(camp);
  }

  for (const [key, group] of byKey) {
    group.sort((a, b) => campCreatedMs(a) - campCreatedMs(b) || String(a._id).localeCompare(String(b._id)));
    for (let i = 0; i < group.length; i += 1) {
      const camp = group[i];
      if (i === 0) {
        if (camp.duplicateKey !== key) {
          updated += 1;
          if (!dryRun) {
            attachDuplicateKey(camp);
            await upsertDocument('camp_ops_camps', camp);
          }
        }
      } else {
        collisionCleared += 1;
        if (!dryRun) {
          if ('duplicateKey' in camp) delete camp.duplicateKey;
          await upsertDocument('camp_ops_camps', camp);
        }
      }
    }
  }

  return {
    dryRun: Boolean(dryRun),
    scanned: active.length,
    updated,
    clearedIncomplete,
    collisionCleared,
    uniqueKeys: byKey.size,
  };
}

function upgradePlaceholderList(list = []) {
  let changed = false;
  const next = (Array.isArray(list) ? list : []).map((p) => {
    if (!p || typeof p !== 'object') return p;
    if (String(p.type || '').toLowerCase() === 'date') return p;
    const token = p.inner || p.label || p.key || '';
    if (!isDateFieldToken(token)) return p;
    changed = true;
    return { ...p, type: 'date' };
  });
  return changed ? next : null;
}

/**
 * Upgrade stored Document One template placeholders so date-named fields use type=date
 * (Todays Date, Effective Date, …). UI also detects by label; this keeps validation/merge consistent.
 */
export async function refreshDocumentTemplateDatePlaceholders({ dryRun = false } = {}) {
  const templates = await loadCollection('document_templates');
  let updated = 0;
  let scanned = 0;

  for (const tpl of templates) {
    if (tpl?.isDeleted) continue;
    scanned += 1;
    const patch = {};
    const placeholders = upgradePlaceholderList(tpl.placeholders);
    if (placeholders) patch.placeholders = placeholders;

    if (Array.isArray(tpl.repeatableTables) && tpl.repeatableTables.length) {
      let tablesChanged = false;
      const tables = tpl.repeatableTables.map((table) => {
        if (!table || typeof table !== 'object') return table;
        const columns = upgradePlaceholderList(table.columns);
        if (!columns) return table;
        tablesChanged = true;
        return { ...table, columns };
      });
      if (tablesChanged) patch.repeatableTables = tables;
    }

    if (!Object.keys(patch).length) continue;
    updated += 1;
    if (dryRun) continue;
    Object.assign(tpl, patch);
    await upsertDocument('document_templates', tpl);
  }

  return { dryRun: Boolean(dryRun), scanned, updated };
}

async function runLockedJob({
  lockId,
  job,
  flagEnv,
  dryRunEnv,
  runner,
  logPrefix,
}) {
  const flag = String(process.env[flagEnv] || 'auto').trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off') return null;

  const dryRun = String(process.env[dryRunEnv] || '').toLowerCase() === 'true';
  const force = flag === 'true';

  const locks = await loadCollection('system_boot_locks');
  const existing = locks.find((row) => String(row._id) === lockId) || null;
  if (!force && !dryRun && existing?.status === 'completed') return null;

  if (!dryRun) {
    await upsertDocument('system_boot_locks', {
      _id: lockId,
      job,
      status: 'running',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  try {
    const result = await runner({ dryRun });
    console.warn(`[${logPrefix}] ${dryRun ? 'dry-run' : 'complete'}:`, result);
    if (!dryRun) {
      await upsertDocument('system_boot_locks', {
        _id: lockId,
        job,
        status: 'completed',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...result,
      });
      if (force) {
        console.warn(`[${logPrefix}] Clear ${flagEnv} after this deploy`);
      }
    }
    return result;
  } catch (err) {
    if (!dryRun) {
      await upsertDocument('system_boot_locks', {
        _id: lockId,
        job,
        status: 'failed',
        error: String(err?.message || err),
        updatedAt: new Date().toISOString(),
      });
    }
    console.error(`[${logPrefix}] failed:`, err.message);
    throw err;
  }
}

export async function maybeRecomputeCampDuplicateKeysOnBoot() {
  return runLockedJob({
    lockId: DUP_LOCK_ID,
    job: 'recompute_camp_duplicate_keys',
    flagEnv: 'RECOMPUTE_CAMP_DUPLICATE_KEYS_ON_BOOT',
    dryRunEnv: 'RECOMPUTE_CAMP_DUPLICATE_KEYS_ON_BOOT_DRY_RUN',
    runner: recomputeCampDuplicateKeys,
    logPrefix: 'camps-dup-keys',
  });
}

export async function maybeRefreshDocumentTemplateDatePlaceholdersOnBoot() {
  return runLockedJob({
    lockId: TPL_LOCK_ID,
    job: 'refresh_doc_template_date_placeholders',
    flagEnv: 'REFRESH_DOC_TEMPLATE_DATE_PLACEHOLDERS_ON_BOOT',
    dryRunEnv: 'REFRESH_DOC_TEMPLATE_DATE_PLACEHOLDERS_ON_BOOT_DRY_RUN',
    runner: refreshDocumentTemplateDatePlaceholders,
    logPrefix: 'doc-templates-dates',
  });
}
