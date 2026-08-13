import { loadCollection, upsertDocument } from '../store/persistence.js';
import { canonicalizeDieticianLabel, canonicalizeDieticianText } from './dieticianSpelling.js';

const LOCK_ID = 'canonicalize_dietician_spelling:v1';

function rewriteLabel(value) {
  const next = canonicalizeDieticianLabel(value);
  return next !== String(value ?? '').trim() ? next : null;
}

function rewriteText(value) {
  const raw = String(value ?? '');
  const next = canonicalizeDieticianText(raw);
  return next !== raw ? next : null;
}

function rewriteStringArray(values) {
  if (!Array.isArray(values)) return null;
  let changed = false;
  const next = values.map((item) => {
    if (typeof item !== 'string') return item;
    const rewritten = canonicalizeDieticianLabel(item);
    if (rewritten !== item.trim() && rewritten !== item) changed = true;
    else if (rewritten !== item) changed = true;
    return rewritten || item;
  });
  return changed ? next : null;
}

/**
 * One-time rewrite of Dietitian → Dietician across reference + operational collections.
 */
export async function canonicalizeDieticianSpellingInData({ dryRun = false } = {}) {
  const summary = {
    dryRun: Boolean(dryRun),
    collections: {},
    totalUpdated: 0,
  };

  async function updateCollection(name, mutate) {
    const rows = await loadCollection(name);
    let updated = 0;
    for (const row of rows) {
      if (row?.isDeleted) continue;
      const patch = mutate(row);
      if (!patch || !Object.keys(patch).length) continue;
      updated += 1;
      if (dryRun) continue;
      Object.assign(row, patch);
      await upsertDocument(name, row);
    }
    summary.collections[name] = updated;
    summary.totalUpdated += updated;
  }

  await updateCollection('contacts', (row) => {
    const patch = {};
    const profession = rewriteLabel(row.profession);
    if (profession) patch.profession = profession;
    const category = rewriteLabel(row.category);
    if (category) patch.category = category;
    if (Array.isArray(row.employees)) {
      let changed = false;
      const employees = row.employees.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        const nextProfession = rewriteLabel(entry.profession);
        if (!nextProfession) return entry;
        changed = true;
        return { ...entry, profession: nextProfession };
      });
      if (changed) patch.employees = employees;
    }
    return patch;
  });

  await updateCollection('camp_ops_camps', (row) => {
    const patch = {};
    for (const key of ['campaignName', 'hcwCategory', 'speciality']) {
      const next = rewriteLabel(row[key]);
      if (next) patch[key] = next;
    }
    const workers = rewriteStringArray(row.healthcareWorkers || row.healthcareWorker);
    if (workers) {
      if (Array.isArray(row.healthcareWorkers)) patch.healthcareWorkers = workers;
      else patch.healthcareWorker = workers;
    }
    return patch;
  });

  await updateCollection('camp_ops_client_masters', (row) => {
    const patch = {};
    const campName = rewriteLabel(row.campName);
    if (campName) patch.campName = campName;
    const workers = rewriteStringArray(row.healthcareWorkers);
    if (workers) patch.healthcareWorkers = workers;
    return patch;
  });

  await updateCollection('logistics_products', (row) => {
    const patch = {};
    const productCategory = rewriteLabel(row.productCategory);
    if (productCategory) patch.productCategory = productCategory;
    const name = rewriteText(row.name);
    if (name) patch.name = name;
    return patch;
  });

  await updateCollection('picklist_suggestions', (row) => {
    const patch = {};
    const value = rewriteLabel(row.value);
    if (value) patch.value = value;
    return patch;
  });

  await updateCollection('asset_requests', (row) => {
    const patch = {};
    for (const key of ['hcwType', 'hiringHcwType', 'method', 'campMethod']) {
      if (row[key] == null) continue;
      const next = key.toLowerCase().includes('method')
        ? rewriteLabel(row[key])
        : rewriteLabel(row[key]);
      if (next) patch[key] = next;
    }
    return patch;
  });

  return summary;
}

export async function maybeCanonicalizeDieticianSpellingOnBoot() {
  const flag = String(process.env.CANONICALIZE_DIETICIAN_SPELLING_ON_BOOT || 'auto').trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off') return null;

  const dryRun = String(process.env.CANONICALIZE_DIETICIAN_SPELLING_ON_BOOT_DRY_RUN || '').toLowerCase() === 'true';
  const force = flag === 'true';

  const locks = await loadCollection('system_boot_locks');
  const existing = locks.find((row) => String(row._id) === LOCK_ID) || null;
  if (!force && !dryRun && existing?.status === 'completed') return null;

  if (!dryRun) {
    await upsertDocument('system_boot_locks', {
      _id: LOCK_ID,
      job: 'canonicalize_dietician_spelling',
      status: 'running',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  try {
    const result = await canonicalizeDieticianSpellingInData({ dryRun });
    console.warn(`[spelling] Dietician canonicalize ${dryRun ? 'dry-run' : 'complete'}:`, result);
    if (!dryRun) {
      await upsertDocument('system_boot_locks', {
        _id: LOCK_ID,
        job: 'canonicalize_dietician_spelling',
        status: 'completed',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...result,
      });
    }
    return result;
  } catch (err) {
    if (!dryRun) {
      await upsertDocument('system_boot_locks', {
        _id: LOCK_ID,
        job: 'canonicalize_dietician_spelling',
        status: 'failed',
        error: String(err?.message || err),
        updatedAt: new Date().toISOString(),
      });
    }
    console.error('[spelling] Dietician canonicalize failed:', err.message);
    throw err;
  }
}
