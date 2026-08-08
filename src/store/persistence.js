import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mergeDocumentFields } from './dataIntegrity.js';

export { mergeDocumentFields, assignPreservingExisting, isBlankValue, pickDefinedPatch, assertNotStale } from './dataIntegrity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mode = 'file';
let mongoDb = null;
let dataDir = path.resolve(__dirname, '../../data');
const cache = new Map();
/** @type {Map<string, number>} file mtimeMs when cache was loaded */
const fileMtime = new Map();
/** Serialize file-mode writes per collection (last writer still wins, but no interleaved writeFile). */
const writeLocks = new Map();
const registeredCollections = new Set();

/** Pretty-print only small collections — large ones blow disk and heap on every rewrite. */
const COMPACT_JSON_MIN_ROWS = 100;
const ALWAYS_COMPACT = new Set(['audit_logs', 'finance_commercial_documents', 'geo_pin_codes']);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function collectionKey(name) {
  return `tylo_${name}`;
}

function filePath(name) {
  return path.join(dataDir, `${name}.json`);
}

function withWriteLock(name, fn) {
  const prev = writeLocks.get(name) || Promise.resolve();
  const run = prev.then(fn, fn);
  writeLocks.set(
    name,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

function shouldCompactJson(name, rows) {
  if (ALWAYS_COMPACT.has(name)) return true;
  return Array.isArray(rows) && rows.length >= COMPACT_JSON_MIN_ROWS;
}

function currentFileMtime(name) {
  try {
    return fs.statSync(filePath(name)).mtimeMs;
  } catch {
    return 0;
  }
}

export function registerCollection(name) {
  registeredCollections.add(name);
}

export function getRegisteredCollections() {
  return [...registeredCollections].sort();
}

export function getPersistenceMode() {
  return mode;
}

export function getDataDirectory() {
  return dataDir;
}

/** Cache footprint for memory diagnostics (doc counts only — no payloads). */
export function getCacheStats() {
  const collections = [];
  let totalDocs = 0;
  for (const [name, rows] of cache.entries()) {
    const count = Array.isArray(rows) ? rows.length : 0;
    totalDocs += count;
    collections.push({ name, count });
  }
  collections.sort((a, b) => b.count - a.count);
  return { mode, collectionCount: collections.length, totalDocs, collections: collections.slice(0, 20) };
}

export function configurePersistence({ backend = 'file', dataDirectory, db } = {}) {
  mode = backend === 'mongo' ? 'mongo' : 'file';
  mongoDb = db || null;
  if (dataDirectory) dataDir = path.resolve(dataDirectory);
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * Persistence model (production assumptions)
 * ------------------------------------------
 * - Mongo mode: each collection is lazy-loaded into a process-local Map cache and kept
 *   resident. Safe topology is a single API replica + Atlas (+ shared/persistent disk
 *   for uploads). Multi-instance without cache invalidation or shared file storage will
 *   serve stale reads and missing files. Native Mongo filter/limit pushdown is the
 *   long-term escape hatch for horizontal scale.
 * - File mode: local JSON under data/ — development only. Collections are lazy-loaded;
 *   loadCollection returns the live cache array (clone matched rows in Query.exec).
 */

/**
 * Mongo: lazy-load collections on first access (do NOT hydrate entire DB into RAM at boot).
 * File: same — lazy-load on first access (avoids boot OOM when audit/commercial JSON is huge).
 */
export async function hydratePersistence() {
  cache.clear();
  fileMtime.clear();
  if (mode === 'mongo') {
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    const collections = await mongoDb.listCollections().toArray();
    const tyloCount = collections.filter(({ name }) => name.startsWith('tylo_')).length;
    console.log(
      `[db] Mongo persistence ready (${tyloCount} collection(s) — lazy-loaded, not pre-hydrated)`
    );
    return;
  }

  let fileCount = 0;
  try {
    fileCount = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json')).length;
  } catch {
    fileCount = 0;
  }
  console.log(
    `[db] File persistence ready at ${dataDir} (${fileCount} json file(s) — lazy-loaded, not pre-hydrated)`
  );
}

/**
 * Return the live collection array (cache reference).
 * Callers that need isolation must clone matched documents themselves (Query.exec does).
 * Deep-cloning the full collection on every read caused multi‑GB RSS spikes with large audits.
 */
export async function loadCollection(name) {
  if (mode === 'mongo') {
    if (cache.has(name)) return cache.get(name);
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    const rows = await mongoDb.collection(collectionKey(name)).find({}).toArray();
    cache.set(name, rows);
    return rows;
  }

  const mtimeMs = currentFileMtime(name);
  if (cache.has(name) && fileMtime.get(name) === mtimeMs) {
    return cache.get(name);
  }
  const rows = readFileCollection(name);
  cache.set(name, rows);
  fileMtime.set(name, mtimeMs);
  return rows;
}

/** Upsert a single document — avoids rewriting the entire collection to Mongo. */
export async function upsertDocument(name, doc) {
  if (!doc?._id) throw new Error('upsertDocument requires _id');
  const incoming = clone(doc);

  if (mode === 'mongo') {
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    const col = mongoDb.collection(collectionKey(name));
    const latest = await col.findOne({ _id: incoming._id });
    const plain = mergeDocumentFields(latest || {}, incoming);
    await col.replaceOne({ _id: plain._id }, plain, { upsert: true });
    const rows = await loadCollection(name);
    const idx = rows.findIndex((r) => String(r._id) === String(plain._id));
    if (idx >= 0) rows[idx] = plain;
    else rows.push(plain);
    return plain;
  }

  const rows = await loadCollection(name);
  const idx = rows.findIndex((r) => String(r._id) === String(incoming._id));
  const plain = mergeDocumentFields(idx >= 0 ? rows[idx] : {}, incoming);
  if (idx >= 0) rows[idx] = plain;
  else rows.push(plain);
  await saveCollection(name, rows);
  return plain;
}

/** Batch upsert — merge each doc with the latest cached/persisted row (no silent field wipe). */
export async function bulkUpsertDocuments(name, docs = []) {
  if (!docs.length) return 0;
  const rows = await loadCollection(name);
  const byId = new Map(rows.map((r, i) => [String(r._id), i]));
  const ops = [];

  for (const doc of docs) {
    if (!doc?._id) continue;
    const incoming = clone(doc);
    const key = String(incoming._id);
    const existing = byId.has(key) ? rows[byId.get(key)] : {};
    const plain = mergeDocumentFields(existing || {}, incoming);
    if (byId.has(key)) rows[byId.get(key)] = plain;
    else {
      byId.set(key, rows.length);
      rows.push(plain);
    }
    if (mode === 'mongo') {
      ops.push({
        replaceOne: {
          filter: { _id: plain._id },
          replacement: plain,
          upsert: true,
        },
      });
    }
  }

  if (mode === 'mongo') {
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    const CHUNK = 500;
    for (let i = 0; i < ops.length; i += CHUNK) {
      await mongoDb.collection(collectionKey(name)).bulkWrite(ops.slice(i, i + CHUNK), {
        ordered: false,
      });
    }
    return ops.length;
  }

  await saveCollection(name, rows);
  return docs.length;
}

export async function saveCollection(name, rows, { allowDestructiveSync = false } = {}) {
  const live = Array.isArray(rows) ? rows : [];

  if (mode === 'mongo') {
    cache.set(name, live);
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    const col = mongoDb.collection(collectionKey(name));
    if (!allowDestructiveSync) {
      // Upsert only — never deleteMany from a potentially stale in-memory snapshot.
      // Intentional full clears must pass { allowDestructiveSync: true }.
      const CHUNK = 500;
      for (let i = 0; i < live.length; i += CHUNK) {
        const slice = live.slice(i, i + CHUNK).filter((doc) => doc?._id);
        if (!slice.length) continue;
        await col.bulkWrite(
          slice.map((doc) => ({
            replaceOne: {
              filter: { _id: doc._id },
              replacement: doc,
              upsert: true,
            },
          })),
          { ordered: false }
        );
      }
      return;
    }
    const ids = live.map((doc) => doc._id);
    if (ids.length) {
      await col.deleteMany({ _id: { $nin: ids } });
      const CHUNK = 500;
      for (let i = 0; i < live.length; i += CHUNK) {
        const slice = live.slice(i, i + CHUNK);
        await col.bulkWrite(
          slice.map((doc) => ({
            replaceOne: {
              filter: { _id: doc._id },
              replacement: doc,
              upsert: true,
            },
          })),
          { ordered: false }
        );
      }
    } else {
      await col.deleteMany({});
    }
    return;
  }

  return withWriteLock(name, async () => {
    cache.set(name, live);
    const compact = shouldCompactJson(name, live);
    const json = compact ? JSON.stringify(live) : JSON.stringify(live, null, 2);
    const target = filePath(name);
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, json);
    try {
      // Prefer atomic replace; on Windows an existing target can EPERM under antivirus/locks.
      fs.renameSync(tmp, target);
    } catch (err) {
      try {
        fs.copyFileSync(tmp, target);
        fs.unlinkSync(tmp);
      } catch (fallbackErr) {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* ignore */
        }
        throw fallbackErr || err;
      }
    }
    fileMtime.set(name, currentFileMtime(name));
  });
}

/**
 * Drop in-memory collection caches. When `keep` is set, those logical names stay cached.
 * Required after raw Mongo deleteMany — otherwise the API keeps serving stale rows and
 * may write them back on the next save/seed.
 */
export function clearPersistenceCache({ keep = [] } = {}) {
  const retain = new Set(keep);
  if (!retain.size) {
    cache.clear();
    fileMtime.clear();
    return;
  }
  for (const name of [...cache.keys()]) {
    if (!retain.has(name)) {
      cache.delete(name);
      fileMtime.delete(name);
    }
  }
}

/** Hard-delete a single document by _id (mongo + file) without wiping sibling docs. */
export async function deleteDocument(name, id) {
  if (!id) return false;
  const rows = await loadCollection(name);
  const idx = rows.findIndex((r) => String(r._id) === String(id));
  if (idx < 0) return false;
  rows.splice(idx, 1);

  if (mode === 'mongo') {
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    await mongoDb.collection(collectionKey(name)).deleteOne({ _id: id });
    cache.set(name, rows);
    return true;
  }

  await saveCollection(name, rows);
  return true;
}

export async function resetAllCollections() {
  cache.clear();
  fileMtime.clear();
  if (mode === 'mongo') {
    if (!mongoDb) return;
    const collections = await mongoDb.listCollections().toArray();
    await Promise.all(
      collections
        .filter(({ name }) => name.startsWith('tylo_'))
        .map(({ name }) => mongoDb.collection(name).drop().catch(() => {}))
    );
    return;
  }
  for (const file of fs.readdirSync(dataDir)) {
    if (file.endsWith('.json')) fs.unlinkSync(path.join(dataDir, file));
  }
}

function readFileCollection(name) {
  const p = filePath(name);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}
