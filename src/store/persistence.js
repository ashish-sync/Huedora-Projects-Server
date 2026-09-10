import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mergeDocumentFields } from './dataIntegrity.js';
import {
  idsEqual,
  isHexObjectId,
  normalizeDocumentEntityIds,
  normalizeEntityId,
} from '../utils/entityIds.js';

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

/**
 * Never retain these in the process-local Map on Render (~512MB).
 * Login/audit writes and PIN masters previously full-hydrated here and OOM'd the instance.
 */
const NEVER_CACHE_COLLECTIONS = new Set([
  'audit_logs',
  'geo_pin_codes',
  'finance_commercial_documents',
  'refresh_tokens',
]);

export function isCacheableCollection(name) {
  return !NEVER_CACHE_COLLECTIONS.has(String(name || ''));
}

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

export function getMongoDb() {
  return mongoDb;
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
  cache.clear();
  fileMtime.clear();
  cacheLoadedAt.clear();
}

/**
 * Persistence model (production assumptions)
 * ------------------------------------------
 * - Mongo mode: cacheable collections lazy-load into a process-local Map.
 *   Critical writes (upsertDocument) merge against a fresh Mongo findOne before
 *   replaceOne, then patch the cache only if already hydrated — never full-scan
 *   just to sync one row (that OOM'd Render free on login → audit_logs).
 * - NEVER_CACHE_COLLECTIONS are query/upsert only; prefer queryCollection().
 * - Safe topology: single API replica + Atlas (+ shared/persistent disk for uploads).
 * - Multi-instance: set MONGO_COLLECTION_CACHE_TTL_MS (e.g. 5000) so each replica
 *   reloads collections periodically. Without a shared cache bus, short TTL is the
 *   supported mitigation — not full linearizability across replicas.
 * - File mode: local JSON under data/ — development only.
 * - Native Mongo filter/limit pushdown remains the long-term escape hatch for scale.
 */

/** @type {Map<string, number>} */
const cacheLoadedAt = new Map();

function mongoCacheTtlMs() {
  const raw = process.env.MONGO_COLLECTION_CACHE_TTL_MS;
  if (raw === undefined || raw === '') return 0; // 0 = hold until explicit clear (single-replica default)
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Exported for unit tests / ops diagnostics */
export function getMongoCollectionCacheTtlMs() {
  return mongoCacheTtlMs();
}

/**
 * Mongo: lazy-load collections on first access (do NOT hydrate entire DB into RAM at boot).
 * File: same — lazy-load on first access (avoids boot OOM when audit/commercial JSON is huge).
 */
export async function hydratePersistence() {
  cache.clear();
  fileMtime.clear();
  cacheLoadedAt.clear();
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
 *
 * Prefer queryCollection() for paginated lists — it never loads the full Mongo collection.
 */
export async function loadCollection(name) {
  if (mode === 'mongo') {
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    // Huge / append-only collections: ephemeral read only — never retain in RSS.
    if (!isCacheableCollection(name)) {
      console.warn(
        `[db] ephemeral full load of ${name} (never-cache) — prefer queryCollection / upsertDocument`,
      );
      return mongoDb.collection(collectionKey(name)).find({}).toArray();
    }
    const ttl = mongoCacheTtlMs();
    const loadedAt = cacheLoadedAt.get(name) || 0;
    const freshEnough = cache.has(name) && (ttl <= 0 || Date.now() - loadedAt < ttl);
    if (freshEnough) return cache.get(name);
    const rows = await mongoDb.collection(collectionKey(name)).find({}).toArray();
    cache.set(name, rows);
    cacheLoadedAt.set(name, Date.now());
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

/**
 * Paginated / filtered read without hydrating the entire Mongo collection.
 * File mode falls back to loadCollection + in-memory match/sort/slice.
 *
 * @param {string} name logical collection name (e.g. camp_ops_camps)
 * @param {{ filter?: object, sort?: object|string, skip?: number, limit?: number|null, projection?: object }} [opts]
 * @returns {Promise<{ data: object[], total: number }>}
 */
export async function queryCollection(name, opts = {}) {
  const filter = opts.filter && typeof opts.filter === 'object' ? opts.filter : {};
  const skip = Math.max(0, Number(opts.skip) || 0);
  const limit = opts.limit == null ? null : Math.max(0, Number(opts.limit));
  const projection = opts.projection && typeof opts.projection === 'object' ? opts.projection : null;
  const sortSpec = normalizeSortSpec(opts.sort);

  if (mode === 'mongo' && mongoDb) {
    const col = mongoDb.collection(collectionKey(name));
    const cursor = col.find(filter);
    if (sortSpec) cursor.sort(sortSpec);
    if (skip) cursor.skip(skip);
    if (limit != null) cursor.limit(limit);
    if (projection) cursor.project(projection);
    const [data, total] = await Promise.all([
      cursor.toArray(),
      col.countDocuments(filter),
    ]);
    return { data, total };
  }

  // File / offline fallback — same semantics as Query.exec (full load once).
  const { matchDocument } = await import('./filedb.js');
  let rows = (await loadCollection(name)).filter((d) => matchDocument(d, filter));
  if (sortSpec) {
    const fields = Object.entries(sortSpec).map(([key, dir]) => ({
      key,
      dir: Number(dir) < 0 ? -1 : 1,
    }));
    rows = rows.slice().sort((a, b) => {
      for (const { key, dir } of fields) {
        const av = key.split('.').reduce((o, k) => (o == null ? o : o[k]), a);
        const bv = key.split('.').reduce((o, k) => (o == null ? o : o[k]), b);
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
      }
      return 0;
    });
  }
  const total = rows.length;
  if (skip) rows = rows.slice(skip);
  if (limit != null) rows = rows.slice(0, limit);
  if (projection) {
    rows = rows.map((row) => projectRow(row, projection));
  } else {
    rows = rows.map((row) => clone(row));
  }
  return { data: rows, total };
}

function normalizeSortSpec(sort) {
  if (!sort) return null;
  if (typeof sort === 'object' && !Array.isArray(sort)) {
    const out = {};
    for (const [key, dirVal] of Object.entries(sort)) {
      out[key] = Number(dirVal) < 0 ? -1 : 1;
    }
    return Object.keys(out).length ? out : null;
  }
  const out = {};
  for (const f of String(sort).split(/\s+/).filter(Boolean)) {
    const key = f.replace(/^-/, '');
    out[key] = f.startsWith('-') ? -1 : 1;
  }
  return Object.keys(out).length ? out : null;
}

function projectRow(row, projection) {
  const includeMode = Object.values(projection).some((v) => Number(v) === 1);
  const next = {};
  if (includeMode) {
    if (projection._id !== 0) next._id = row._id;
    for (const [k, v] of Object.entries(projection)) {
      if (k === '_id') continue;
      if (Number(v) === 1 && Object.prototype.hasOwnProperty.call(row, k)) next[k] = row[k];
    }
    return next;
  }
  Object.assign(next, clone(row));
  for (const [k, v] of Object.entries(projection)) {
    if (Number(v) === 0) delete next[k];
  }
  return next;
}

/** Ensure common list indexes (non-blocking; safe to call on boot). */
export async function ensureListIndexes() {
  if (mode !== 'mongo' || !mongoDb) return { skipped: true };
  const specs = [
    {
      name: 'camp_ops_camps',
      indexes: [
        { key: { isDeleted: 1, campDate: 1, startTime: 1 }, name: 'list_deleted_date_time' },
        { key: { isDeleted: 1, clientId: 1, campDate: 1 }, name: 'list_deleted_client_date' },
        { key: { isDeleted: 1, status: 1, lifecycleStage: 1 }, name: 'list_deleted_status_stage' },
      ],
    },
    {
      name: 'camp_ops_clients',
      indexes: [{ key: { isDeleted: 1, name: 1 }, name: 'list_deleted_name' }],
    },
    {
      name: 'contacts',
      indexes: [
        { key: { isDeleted: 1, contactCategory: 1, name: 1 }, name: 'list_deleted_category_name' },
      ],
    },
  ];
  const results = [];
  for (const spec of specs) {
    const col = mongoDb.collection(collectionKey(spec.name));
    for (const idx of spec.indexes) {
      try {
        await col.createIndex(idx.key, { name: idx.name, background: true });
        results.push({ collection: spec.name, index: idx.name, ok: true });
      } catch (err) {
        results.push({
          collection: spec.name,
          index: idx.name,
          ok: false,
          error: String(err?.message || err).slice(0, 200),
        });
      }
    }
  }
  return { ok: true, results };
}

/**
 * Run an aggregation pipeline against a collection (Mongo only).
 * File mode returns null so callers can fall back.
 */
export async function aggregateCollection(name, pipeline = []) {
  if (mode !== 'mongo' || !mongoDb) return null;
  return mongoDb.collection(collectionKey(name)).aggregate(pipeline).toArray();
}

export function mongoCollectionName(logicalName) {
  return collectionKey(logicalName);
}

/** Upsert a single document — avoids rewriting the entire collection to Mongo. */
export async function upsertDocument(name, doc, { session = null } = {}) {
  if (!doc?._id) throw new Error('upsertDocument requires _id');
  const incoming = normalizeDocumentEntityIds(clone(doc));

  if (mode === 'mongo') {
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    const col = mongoDb.collection(collectionKey(name));
    const findOpts = session ? { session } : {};
    const writeOpts = session ? { upsert: true, session } : { upsert: true };
    let existing = await col.findOne({ _id: incoming._id }, findOpts);
    if (!existing && isHexObjectId(incoming._id)) {
      const raw = String(doc._id || '');
      if (raw && raw !== incoming._id) existing = await col.findOne({ _id: raw }, findOpts);
    }
    const plain = mergeDocumentFields(existing || {}, incoming);
    plain._id = normalizeEntityId(plain._id) || plain._id;
    await col.replaceOne({ _id: plain._id }, plain, writeOpts);
    if (existing && String(existing._id) !== String(plain._id)) {
      await col.deleteOne({ _id: existing._id }, session ? { session } : {});
    }
    // Patch cache only if already hydrated — never find({}).toArray() for one write.
    if (cache.has(name) && isCacheableCollection(name)) {
      const rows = cache.get(name);
      const idx = rows.findIndex((r) => idsEqual(r._id, plain._id));
      if (idx >= 0) rows[idx] = plain;
      else rows.push(plain);
    }
    return plain;
  }

  const rows = await loadCollection(name);
  const idx = rows.findIndex((r) => idsEqual(r._id, incoming._id));
  const plain = mergeDocumentFields(idx >= 0 ? rows[idx] : {}, incoming);
  plain._id = normalizeEntityId(plain._id) || plain._id;
  if (idx >= 0) rows[idx] = plain;
  else rows.push(plain);
  await saveCollection(name, rows);
  return plain;
}

/** Batch upsert — merge each doc with the latest cached/persisted row (no silent field wipe). */
export async function bulkUpsertDocuments(name, docs = [], { session = null, replace = false } = {}) {
  if (!docs.length) return 0;

  if (mode === 'mongo') {
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    const col = mongoDb.collection(collectionKey(name));
    const findOpts = session ? { session } : {};
    const cached = cache.has(name) && isCacheableCollection(name) ? cache.get(name) : null;
    const byId = cached
      ? new Map(cached.map((r, i) => [normalizeEntityId(r._id) || String(r._id), i]))
      : null;
    const ops = [];

    for (const doc of docs) {
      if (!doc?._id) continue;
      const incoming = normalizeDocumentEntityIds(clone(doc));
      const key = normalizeEntityId(incoming._id) || String(incoming._id);
      let existing = {};
      if (!replace) {
        if (byId?.has(key)) existing = cached[byId.get(key)] || {};
        else existing = (await col.findOne({ _id: key }, findOpts)) || {};
      }
      const plain = replace
        ? { ...(incoming || {}), _id: key }
        : mergeDocumentFields(existing || {}, incoming);
      plain._id = key;
      if (cached) {
        if (byId.has(key)) cached[byId.get(key)] = plain;
        else {
          byId.set(key, cached.length);
          cached.push(plain);
        }
      }
      ops.push({
        replaceOne: {
          filter: { _id: plain._id },
          replacement: plain,
          upsert: true,
        },
      });
    }

    const CHUNK = 500;
    const writeOpts = session ? { ordered: true, session } : { ordered: false };
    for (let i = 0; i < ops.length; i += CHUNK) {
      await col.bulkWrite(ops.slice(i, i + CHUNK), writeOpts);
    }
    return ops.length;
  }

  const rows = await loadCollection(name);
  const byId = new Map(rows.map((r, i) => [normalizeEntityId(r._id) || String(r._id), i]));

  for (const doc of docs) {
    if (!doc?._id) continue;
    const incoming = normalizeDocumentEntityIds(clone(doc));
    const key = normalizeEntityId(incoming._id) || String(incoming._id);
    const existing = byId.has(key) ? rows[byId.get(key)] : {};
    const plain = replace
      ? { ...(incoming || {}), _id: key }
      : mergeDocumentFields(existing || {}, incoming);
    plain._id = key;
    if (byId.has(key)) rows[byId.get(key)] = plain;
    else {
      byId.set(key, rows.length);
      rows.push(plain);
    }
  }

  await saveCollection(name, rows);
  return docs.length;
}

export async function saveCollection(name, rows, { allowDestructiveSync = false } = {}) {
  const live = Array.isArray(rows) ? rows : [];

  if (mode === 'mongo') {
    if (isCacheableCollection(name)) {
      cache.set(name, live);
      cacheLoadedAt.set(name, Date.now());
    } else {
      cache.delete(name);
      cacheLoadedAt.delete(name);
    }
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
    cacheLoadedAt.clear();
    return;
  }
  for (const name of [...cache.keys()]) {
    if (!retain.has(name)) {
      cache.delete(name);
      fileMtime.delete(name);
      cacheLoadedAt.delete(name);
    }
  }
}

/** Hard-delete a single document by _id (mongo + file) without wiping sibling docs. */
export async function deleteDocument(name, id) {
  if (!id) return false;

  if (mode === 'mongo') {
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    const col = mongoDb.collection(collectionKey(name));
    const result = await col.deleteOne({ _id: id });
    let deleted = (result?.deletedCount || 0) > 0;
    if (!deleted && isHexObjectId(id)) {
      const alt = await col.deleteOne({ _id: String(id) });
      deleted = (alt?.deletedCount || 0) > 0;
    }
    if (cache.has(name)) {
      const rows = cache.get(name);
      const idx = rows.findIndex((r) => String(r._id) === String(id));
      if (idx >= 0) rows.splice(idx, 1);
    }
    return deleted;
  }

  const rows = await loadCollection(name);
  const idx = rows.findIndex((r) => String(r._id) === String(id));
  if (idx < 0) return false;
  rows.splice(idx, 1);
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
