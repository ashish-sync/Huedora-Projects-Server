import { randomBytes } from 'crypto';
import {
  loadCollection,
  saveCollection,
  upsertDocument,
  bulkUpsertDocuments,
  deleteDocument,
  getPersistenceMode,
  resetAllCollections,
  registerCollection,
  getRegisteredCollections,
  mergeDocumentFields,
} from './persistence.js';
import { entityIdMapKey, idsEqual } from '../utils/entityIds.js';

function oid() {
  return randomBytes(12).toString('hex');
}

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function match(doc, filter = {}) {
  if (!filter || !Object.keys(filter).length) return true;
  return Object.entries(filter).every(([key, val]) => {
    if (key === '$or') return val.some((f) => match(doc, f));
    if (key === '$and') return val.every((f) => match(doc, f));
    if (val && typeof val === 'object' && !(val instanceof Date) && !Array.isArray(val)) {
      if (val.$in) {
        const current = get(doc, key);
        const values = val.$in;
        return Array.isArray(current)
          ? current.some((item) => values.some((expected) => idsEqual(item, expected)))
          : values.some((expected) => idsEqual(current, expected));
      }
      if (val.$nin) {
        const current = get(doc, key);
        const values = val.$nin;
        return Array.isArray(current)
          ? current.every((item) => values.every((expected) => !idsEqual(item, expected)))
          : values.every((expected) => !idsEqual(current, expected));
      }
      if (Object.prototype.hasOwnProperty.call(val, '$ne')) {
        const current = get(doc, key);
        const expected = val.$ne;
        // Match Mongo semantics: null/undefined are unequal to any concrete value.
        if (expected == null) return current != null && current !== '';
        if (current == null) return expected != null;
        return !idsEqual(current, expected);
      }
      if (val.$exists !== undefined) {
        const parts = key.split('.');
        let cur = doc;
        let exists = true;
        for (const part of parts) {
          if (cur == null || !Object.prototype.hasOwnProperty.call(cur, part)) {
            exists = false;
            break;
          }
          cur = cur[part];
        }
        return val.$exists ? exists : !exists;
      }
      if (val.$gte || val.$gt || val.$lte || val.$lt) {
        const cur = get(doc, key);
        const t = cur instanceof Date || !Number.isNaN(Date.parse(cur)) ? new Date(cur).getTime() : Number(cur);
        if (val.$gte && t < new Date(val.$gte).getTime()) return false;
        if (val.$gt && t <= new Date(val.$gt).getTime()) return false;
        if (val.$lte && t > new Date(val.$lte).getTime()) return false;
        if (val.$lt && t >= new Date(val.$lt).getTime()) return false;
        return true;
      }
      if (val instanceof RegExp) return val.test(String(get(doc, key) ?? ''));
      if (val.$regex) {
        const r = new RegExp(val.$regex, val.$options || 'i');
        return r.test(String(get(doc, key) ?? ''));
      }
    }
    if (val instanceof RegExp) return val.test(String(get(doc, key) ?? ''));
    const cur = get(doc, key);
    if (cur && typeof cur === 'object' && cur._id) return idsEqual(cur._id, val);
    return idsEqual(cur, val);
  });
}

function get(obj, key) {
  return key.split('.').reduce((a, k) => (a == null ? a : a[k]), obj);
}

function applyUpdate(doc, update) {
  const next = clone(doc);
  if (update.$set) {
    for (const [k, v] of Object.entries(update.$set)) setPath(next, k, v);
  } else if (update.$inc) {
    for (const [k, v] of Object.entries(update.$inc)) setPath(next, k, Number(get(next, k) || 0) + v);
  } else if (update.$unset) {
    for (const k of Object.keys(update.$unset)) {
      const parts = k.split('.');
      let cur = next;
      for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') return;
        cur = cur[parts[i]];
      }
      delete cur[parts[parts.length - 1]];
    }
  } else {
    // Partial merge — blank/omitted fields must not wipe existing data.
    Object.assign(next, mergeDocumentFields(next, update), { _id: doc._id });
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

function setPath(obj, key, value) {
  const parts = key.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

const SENSITIVE_POPULATE_FIELDS = new Set([
  'passwordHash',
  'refreshToken',
  'refreshTokens',
  'refreshTokenHash',
  'accessToken',
  'tokenHash',
  'secret',
  'secrets',
]);

function unsetPath(obj, key) {
  const parts = key.split('.');
  const leaf = parts.pop();
  const parent = parts.reduce((value, part) => value?.[part], obj);
  if (parent && leaf) delete parent[leaf];
}

function sanitizePopulated(value) {
  if (Array.isArray(value)) return value.map(sanitizePopulated);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_POPULATE_FIELDS.has(key) || /password|secret|^refresh/i.test(key)) continue;
    out[key] = sanitizePopulated(child);
  }
  return out;
}

function project(doc, select, { sanitize = false } = {}) {
  const source = sanitize ? sanitizePopulated(clone(doc)) : clone(doc);
  if (!select) return source;

  const spec =
    typeof select === 'string'
      ? Object.fromEntries(
          select
            .split(/\s+/)
            .filter(Boolean)
            .map((field) => [field.replace(/^-/, ''), field.startsWith('-') ? 0 : 1]),
        )
      : select;
  const entries = Object.entries(spec || {});
  const included = entries.filter(([, flag]) => Boolean(flag)).map(([field]) => field);
  const excluded = entries.filter(([, flag]) => !flag).map(([field]) => field);

  if (included.length) {
    const out = {};
    if (source._id != null && spec._id !== 0) out._id = source._id;
    for (const field of included) {
      if (field === '_id') continue;
      const value = get(source, field);
      if (value !== undefined) setPath(out, field, value);
    }
    return sanitize ? sanitizePopulated(out) : out;
  }
  for (const field of excluded) unsetPath(source, field);
  return sanitize ? sanitizePopulated(source) : source;
}

class Query {
  constructor(model, filter = {}) {
    this.model = model;
    this.filter = filter;
    this._sort = null;
    this._skip = 0;
    this._limit = null;
    this._populate = [];
    this._select = null;
  }

  sort(s) {
    this._sort = s;
    return this;
  }

  skip(n) {
    this._skip = n || 0;
    return this;
  }

  limit(n) {
    this._limit = n;
    return this;
  }

  populate(field, select) {
    this._populate.push({ field, select });
    return this;
  }

  select(fields) {
    this._select = fields;
    return this;
  }

  lean() {
    return this;
  }

  async then(resolve, reject) {
    try {
      resolve(await this.exec());
    } catch (e) {
      reject?.(e);
    }
  }

  async exec() {
    // Match/sort on cache refs — clone only after skip/limit (avoids OOM on paginated finds).
    let rows = (await this.model._all()).filter((d) => match(d, this.filter));
    if (this._sort) {
      const fields = [];
      if (typeof this._sort === 'object' && !Array.isArray(this._sort)) {
        for (const [key, dirVal] of Object.entries(this._sort)) {
          fields.push({ key, dir: Number(dirVal) < 0 ? -1 : 1 });
        }
      } else {
        for (const f of String(this._sort).split(/\s+/).filter(Boolean)) {
          fields.push({
            key: f.replace(/^-/, ''),
            dir: f.startsWith('-') ? -1 : 1,
          });
        }
      }
      rows = rows.slice();
      rows.sort((a, b) => {
        for (const { key, dir } of fields) {
          const av = get(a, key);
          const bv = get(b, key);
          if (av < bv) return -1 * dir;
          if (av > bv) return 1 * dir;
        }
        return 0;
      });
    }
    if (this._skip) rows = rows.slice(this._skip);
    if (this._limit != null) rows = rows.slice(0, this._limit);
    rows = rows.map(clone);
    for (const p of this._populate) {
      await this.model._populateMany(rows, p.field, p.select);
    }
    if (this._select) rows = rows.map((row) => project(row, this._select));
    return rows.map((r) => this.model._wrap(r, { alreadyCloned: true }));
  }
}

/** Build _id → doc Map for a collection (rebuilt when the live array reference changes). */
const idIndexByCollection = new Map();

async function idIndexFor(name) {
  const rows = await loadCollection(name);
  let entry = idIndexByCollection.get(name);
  if (!entry || entry.rows !== rows || entry.size !== rows.length) {
    const map = new Map();
    for (const row of rows) {
      const key = entityIdMapKey(row._id);
      if (key) map.set(key, row);
      // Keep raw key too so exact lookups still work during transition.
      const raw = String(row._id ?? '');
      if (raw && raw !== key) map.set(raw, row);
    }
    entry = { rows, map, size: rows.length };
    idIndexByCollection.set(name, entry);
  }
  return entry.map;
}

export function invalidateIdIndex(name) {
  if (name) idIndexByCollection.delete(name);
  else idIndexByCollection.clear();
}

/**
 * Scan a collection without cloning. Callback receives live cache refs — do not mutate.
 * @returns {Promise<number>} number of matching docs visited
 */
export async function scanCollection(name, { filter = {}, forEach } = {}) {
  const all = await loadCollection(name);
  let n = 0;
  for (const d of all) {
    if (!match(d, filter)) continue;
    n += 1;
    if (forEach) forEach(d);
  }
  return n;
}

export { match as matchDocument };
export { loadCollection };

export function defineCollection(name, defaults = {}) {
  registerCollection(name);
  const model = {
    modelName: name,
    async _all() {
      return loadCollection(name);
    },
    async _write(rows, { allowDestructiveSync = false } = {}) {
      await saveCollection(name, rows, { allowDestructiveSync });
    },
    _wrap(doc, { alreadyCloned = false } = {}) {
      const o = alreadyCloned ? doc : clone(doc);
      o.toObject = () => {
        const plain = { ...o };
        delete plain.toObject;
        delete plain.save;
        delete plain.populate;
        return clone(plain);
      };
      o.save = async () => {
        const plain = { ...o };
        delete plain.toObject;
        delete plain.save;
        delete plain.populate;
        plain.updatedAt = new Date().toISOString();
        // Single-doc upsert in mongo mode — avoids rewriting entire collections (OOM risk).
        await upsertDocument(name, plain);
        invalidateIdIndex(name);
        Object.assign(o, plain);
        return o;
      };
      o.populate = async (field, select) => {
        await model._populateMany([o], field, select);
        return o;
      };
      return o;
    },
    async _populateMany(rows, field, select) {
      if (!rows?.length) return;
      if (field === 'roleIds') {
        const byId = await idIndexFor('roles');
        for (const row of rows) {
          if (!Array.isArray(row.roleIds)) continue;
          row.roleIds = row.roleIds.map((id) => {
            const found = byId.get(entityIdMapKey(id?._id || id)) || byId.get(String(id?._id || id));
            return found ? project(found, select, { sanitize: true }) : id;
          });
        }
        return;
      }
      if (field === 'assets' || field === 'assets.assetId') {
        const byId = await idIndexFor('assets');
        for (const row of rows) {
          if (!Array.isArray(row.assets)) continue;
          row.assets = row.assets.map((a) => ({
            ...a,
            assetId: (() => {
              const found = byId.get(String(a.assetId?._id || a.assetId));
              return found ? project(found, select, { sanitize: true }) : a.assetId;
            })(),
          }));
        }
        return;
      }
      if (field === 'to.hcwId') {
        const byId = await idIndexFor('hcws');
        for (const row of rows) {
          if (!row.to) continue;
          const found = byId.get(String(row.to.hcwId?._id || row.to.hcwId));
          if (found) row.to = { ...row.to, hcwId: project(found, select, { sanitize: true }) };
        }
        return;
      }
      const map = {
        deviceMasterId: 'device_masters',
        hcwId: 'hcws',
        contactId: 'contacts',
        fromContactId: 'contacts',
        toContactId: 'contacts',
        preferredVendorContactId: 'contacts',
        traineeContactId: 'contacts',
        activeAgreementId: 'agreements',
        assetId: 'assets',
        requestorId: 'users',
        approverId: 'users',
        createdById: 'users',
        requestId: 'asset_requests',
        campaignId: 'verification_campaigns',
        userId: 'users',
        reportedByUserId: 'users',
        receivedByUserId: 'users',
        reportingManagerId: 'users',
      };
      const col = map[field];
      if (!col) return;
      const byId = await idIndexFor(col);
      for (const row of rows) {
        const val = row[field];
        if (val == null) continue;
        const found = byId.get(String(val?._id || val));
        if (found) row[field] = project(found, select, { sanitize: true });
      }
    },
    async _populateOne(row, field, select) {
      await model._populateMany([row], field, select);
    },
    find(filter = {}) {
      return new Query(model, filter);
    },
    findOne(filter = {}) {
      const q = new Query(model, filter);
      q.limit(1);
      const orig = q.exec.bind(q);
      q.exec = async () => {
        const rows = await orig();
        return rows[0] || null;
      };
      return q;
    },
    findById(id) {
      return model.findOne({ _id: String(id) });
    },
    async findOneAndUpdate(filter, update, opts = {}) {
      const rows = await model._all();
      const idx = rows.findIndex((d) => match(d, filter));
      if (idx < 0) {
        if (opts.upsert) {
          const created = await model.create({ ...filter, ...(update.$set || update) });
          return created;
        }
        return null;
      }
      rows[idx] = applyUpdate(rows[idx], update);
      await upsertDocument(name, rows[idx]);
      invalidateIdIndex(name);
      return model._wrap(rows[idx]);
    },
    async findByIdAndUpdate(id, update, opts = {}) {
      return model.findOneAndUpdate({ _id: String(id) }, update, opts);
    },
    async create(doc) {
      const now = new Date().toISOString();
      const base = typeof defaults === 'function' ? defaults() : clone(defaults);
      const row = {
        ...base,
        ...clone(doc),
        _id: doc._id || oid(),
        createdAt: doc.createdAt || now,
        updatedAt: now,
      };
      await upsertDocument(name, row);
      invalidateIdIndex(name);
      return model._wrap(row);
    },
    async insertMany(docs) {
      if (!docs?.length) return [];
      const now = new Date().toISOString();
      const base = typeof defaults === 'function' ? defaults() : clone(defaults);
      const rows = docs.map((doc) => ({
        ...base,
        ...clone(doc),
        _id: doc._id || oid(),
        createdAt: doc.createdAt || now,
        updatedAt: now,
      }));
      await bulkUpsertDocuments(name, rows);
      invalidateIdIndex(name);
      return rows.map((row) => model._wrap(row));
    },
    async countDocuments(filter = {}) {
      return scanCollection(name, { filter });
    },
    async updateOne(filter, update) {
      const rows = await model._all();
      const idx = rows.findIndex((d) => match(d, filter));
      if (idx < 0) return { matchedCount: 0, modifiedCount: 0 };
      rows[idx] = applyUpdate(rows[idx], update);
      await upsertDocument(name, rows[idx]);
      invalidateIdIndex(name);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async updateMany(filter, update) {
      const rows = await model._all();
      const changed = [];
      for (let i = 0; i < rows.length; i++) {
        if (match(rows[i], filter)) {
          rows[i] = applyUpdate(rows[i], update);
          changed.push(rows[i]);
        }
      }
      if (changed.length) {
        if (getPersistenceMode() === 'mongo') await bulkUpsertDocuments(name, changed);
        else await model._write(rows);
        invalidateIdIndex(name);
      }
      return { matchedCount: changed.length, modifiedCount: changed.length };
    },
    async deleteOne(filter = {}) {
      const rows = await model._all();
      const idx = rows.findIndex((d) => match(d, filter));
      if (idx < 0) return { deletedCount: 0 };
      const removed = rows[idx];
      await deleteDocument(name, removed._id);
      invalidateIdIndex(name);
      return { deletedCount: 1, deletedId: removed._id };
    },
    async deleteMany() {
      await model._write([], { allowDestructiveSync: true });
      invalidateIdIndex(name);
    },
    async aggregate(pipeline = []) {
      // Aggregate over refs until $group; only clone grouped result docs.
      let rows = await model._all();
      for (const stage of pipeline) {
        if (stage.$match) rows = rows.filter((d) => match(d, stage.$match));
        if (stage.$group) {
          const map = new Map();
          const idExpr = stage.$group._id;
          const field =
            typeof idExpr === 'string' && idExpr.startsWith('$') ? idExpr.slice(1) : idExpr;
          for (const r of rows) {
            const keyVal = get(r, field);
            const k = String(keyVal);
            if (!map.has(k)) map.set(k, { _id: keyVal, count: 0 });
            if (stage.$group.count?.$sum != null) map.get(k).count += Number(stage.$group.count.$sum);
          }
          rows = [...map.values()];
        }
      }
      return rows.map(clone);
    },
  };
  return model;
}

export async function resetAllData() {
  await resetAllCollections();
}

export { getRegisteredCollections };
