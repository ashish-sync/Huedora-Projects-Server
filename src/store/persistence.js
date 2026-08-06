import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mode = 'file';
let mongoDb = null;
let dataDir = path.resolve(__dirname, '../../data');
const cache = new Map();
const registeredCollections = new Set();

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function collectionKey(name) {
  return `tylo_${name}`;
}

function filePath(name) {
  return path.join(dataDir, `${name}.json`);
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
 * - File mode: local JSON under data/ — development only.
 */

/**
 * Mongo: lazy-load collections on first access (do NOT hydrate entire DB into RAM at boot).
 * File: keep existing JSON index for CLI/dev sync.
 */
export async function hydratePersistence() {
  cache.clear();
  if (mode === 'mongo') {
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    const collections = await mongoDb.listCollections().toArray();
    const tyloCount = collections.filter(({ name }) => name.startsWith('tylo_')).length;
    console.log(
      `[db] Mongo persistence ready (${tyloCount} collection(s) — lazy-loaded, not pre-hydrated)`
    );
    return;
  }

  for (const file of fs.readdirSync(dataDir)) {
    if (!file.endsWith('.json')) continue;
    const logicalName = file.replace(/\.json$/, '');
    cache.set(logicalName, readFileCollection(logicalName));
  }
}

/**
 * Return the live collection array (cache reference in mongo mode).
 * Callers that need isolation must clone matched documents themselves (Query.exec does).
 * Deep-cloning the full collection on every read caused Render 512MB OOMs.
 */
export async function loadCollection(name) {
  if (mode === 'mongo') {
    if (cache.has(name)) return cache.get(name);
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    const rows = await mongoDb.collection(collectionKey(name)).find({}).toArray();
    cache.set(name, rows);
    return rows;
  }
  // Local JSON store: always read from disk so CLI scripts and the dev server stay in sync.
  const rows = readFileCollection(name);
  cache.set(name, rows);
  return clone(rows);
}

/** Upsert a single document — avoids rewriting the entire collection to Mongo. */
export async function upsertDocument(name, doc) {
  if (!doc?._id) throw new Error('upsertDocument requires _id');
  const rows = await loadCollection(name);
  const idx = rows.findIndex((r) => String(r._id) === String(doc._id));
  const plain = clone(doc);
  if (idx >= 0) rows[idx] = plain;
  else rows.push(plain);

  if (mode === 'mongo') {
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    await mongoDb.collection(collectionKey(name)).replaceOne(
      { _id: plain._id },
      plain,
      { upsert: true }
    );
    // Size change invalidates id indexes in filedb (reference stays same when updating in place).
    return plain;
  }
  await saveCollection(name, rows);
  return plain;
}

/** Batch upsert — constant-ish Mongo writes vs full-collection rewrite. */
export async function bulkUpsertDocuments(name, docs = []) {
  if (!docs.length) return 0;
  const rows = await loadCollection(name);
  const byId = new Map(rows.map((r, i) => [String(r._id), i]));
  const ops = [];

  for (const doc of docs) {
    if (!doc?._id) continue;
    const plain = clone(doc);
    const key = String(plain._id);
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

export async function saveCollection(name, rows) {
  const snapshot = mode === 'mongo' ? rows : clone(rows);
  if (mode === 'mongo') {
    // Keep cache pointing at the live array (same reference when caller passed cache).
    cache.set(name, Array.isArray(rows) ? rows : snapshot);
  } else {
    cache.set(name, snapshot);
  }

  if (mode === 'mongo') {
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    const col = mongoDb.collection(collectionKey(name));
    const live = cache.get(name) || [];
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
  fs.writeFileSync(filePath(name), JSON.stringify(snapshot, null, 2));
}

export async function resetAllCollections() {
  cache.clear();
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
