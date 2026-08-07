import fs from 'fs';
import path from 'path';
import {
  clearPersistenceCache,
  getPersistenceMode,
  getRegisteredCollections,
  loadCollection,
  saveCollection,
} from '../store/persistence.js';
import { invalidateIdIndex } from '../store/filedb.js';
import { uploadsRoot } from '../config/paths.js';

/** Collections preserved so existing logins and role assignments keep working. */
export const FRESH_START_KEEP_COLLECTIONS = new Set([
  'users',
  'roles',
  'refresh_tokens',
  // India geo / city master (state-wise city list) — do not wipe
  'geo_states',
  'geo_districts',
  'geo_cities',
  'geo_zones',
  'geo_pin_codes',
]);

function clearDirectory(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      clearDirectory(full);
    } else {
      fs.unlinkSync(full);
    }
  }
}

/**
 * Wipe all application data except users, roles, and refresh tokens.
 * Re-seed system reference data (geo, roles repair, logistics picklists) afterward via ensureSeed.
 *
 * Always clears the process-local persistence cache for wiped collections so Mongo-mode
 * APIs do not keep serving (or re-persisting) stale rows after deleteMany.
 */
export async function freshStartKeepUsers({ clearUploads = true } = {}) {
  const mode = getPersistenceMode();
  const cleared = [];

  if (mode === 'mongo') {
    const mongoose = (await import('mongoose')).default;
    const db = mongoose.connection?.db;
    if (!db) throw new Error('MongoDB is not connected');

    const collections = await db.listCollections().toArray();
    for (const { name } of collections) {
      if (!name.startsWith('tylo_')) continue;
      const logical = name.slice('tylo_'.length);
      if (FRESH_START_KEEP_COLLECTIONS.has(logical)) continue;
      // saveCollection([],) clears Mongo and replaces the in-memory cache entry.
      await saveCollection(logical, []);
      cleared.push(logical);
    }
  } else {
    const names = new Set([
      ...getRegisteredCollections(),
      ...(await listFileCollections()),
    ]);
    for (const name of names) {
      if (FRESH_START_KEEP_COLLECTIONS.has(name)) continue;
      await saveCollection(name, []);
      cleared.push(name);
    }
  }

  // Drop any other cached collections that were never listed (or loaded under aliases).
  clearPersistenceCache({ keep: [...FRESH_START_KEEP_COLLECTIONS] });
  invalidateIdIndex();

  // Ensure keep-collections stay loadable even if empty roles somehow missing.
  for (const name of FRESH_START_KEEP_COLLECTIONS) {
    await loadCollection(name).catch(() => []);
  }

  if (clearUploads) {
    fs.mkdirSync(uploadsRoot, { recursive: true });
    clearDirectory(uploadsRoot);
  }

  cleared.sort();
  console.warn(
    `[fresh-start] Cleared ${cleared.length} collection(s); kept users/roles/refresh_tokens and geo city masters`,
  );
  return { cleared, kept: [...FRESH_START_KEEP_COLLECTIONS] };
}

async function listFileCollections() {
  const { getDataDirectory } = await import('../store/persistence.js');
  const dataDir = getDataDirectory();
  if (!fs.existsSync(dataDir)) return [];
  return fs
    .readdirSync(dataDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''));
}
