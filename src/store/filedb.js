import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');
fs.mkdirSync(dataDir, { recursive: true });

function oid() {
  return randomBytes(12).toString('hex');
}

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function getPath(name) {
  return path.join(dataDir, `${name}.json`);
}

function load(name) {
  const p = getPath(name);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

function save(name, rows) {
  fs.writeFileSync(getPath(name), JSON.stringify(rows, null, 2));
}

function match(doc, filter = {}) {
  if (!filter || !Object.keys(filter).length) return true;
  return Object.entries(filter).every(([key, val]) => {
    if (key === '$or') return val.some((f) => match(doc, f));
    if (key === '$and') return val.every((f) => match(doc, f));
    if (val && typeof val === 'object' && !(val instanceof Date) && !Array.isArray(val)) {
      if (val.$in) return val.$in.map(String).includes(String(get(doc, key)));
      if (val.$nin) return !val.$nin.map(String).includes(String(get(doc, key)));
      if (val.$ne) return String(get(doc, key)) !== String(val.$ne);
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
    if (cur && typeof cur === 'object' && cur._id) return String(cur._id) === String(val);
    return String(cur) === String(val);
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
  } else {
    Object.assign(next, update, { _id: doc._id });
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

class Query {
  constructor(model, filter = {}) {
    this.model = model;
    this.filter = filter;
    this._sort = null;
    this._skip = 0;
    this._limit = null;
    this._populate = [];
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

  select() {
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
    let rows = this.model._all().filter((d) => match(d, this.filter)).map(clone);
    if (this._sort) {
      const fields = String(this._sort).split(/\s+/).filter(Boolean);
      rows.sort((a, b) => {
        for (const f of fields) {
          const dir = f.startsWith('-') ? -1 : 1;
          const key = f.replace(/^-/, '');
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
    for (const p of this._populate) {
      for (const row of rows) await this.model._populateOne(row, p.field);
    }
    return rows.map((r) => this.model._wrap(r));
  }
}

export function defineCollection(name, defaults = {}) {
  const model = {
    modelName: name,
    _all() {
      return load(name);
    },
    _write(rows) {
      save(name, rows);
    },
    _wrap(doc) {
      const o = clone(doc);
      o.toObject = () => clone(o);
      o.save = async () => {
        const rows = model._all();
        const idx = rows.findIndex((r) => String(r._id) === String(o._id));
        const plain = { ...o };
        delete plain.toObject;
        delete plain.save;
        delete plain.populate;
        plain.updatedAt = new Date().toISOString();
        if (idx >= 0) rows[idx] = plain;
        else rows.push(plain);
        model._write(rows);
        Object.assign(o, plain);
        return o;
      };
      o.populate = async (field) => {
        await model._populateOne(o, field);
        return o;
      };
      return o;
    },
    async _populateOne(row, field) {
      if (field === 'roleIds' && Array.isArray(row.roleIds)) {
        const all = load('roles');
        row.roleIds = row.roleIds.map((id) => all.find((x) => String(x._id) === String(id?._id || id)) || id);
        return;
      }
      if (field === 'assets' || field === 'assets.assetId') {
        if (!Array.isArray(row.assets)) return;
        const assets = load('assets');
        row.assets = row.assets.map((a) => ({
          ...a,
          assetId: assets.find((x) => String(x._id) === String(a.assetId?._id || a.assetId)) || a.assetId,
        }));
        return;
      }
      if (field === 'to.hcwId') {
        if (!row.to) return;
        const all = load('hcws');
        const id = row.to.hcwId?._id || row.to.hcwId;
        const found = all.find((x) => String(x._id) === String(id));
        if (found) row.to = { ...row.to, hcwId: clone(found) };
        return;
      }
      const map = {
        deviceMasterId: 'device_masters',
        hcwId: 'hcws',
        contactId: 'contacts',
        activeAgreementId: 'agreements',
        assetId: 'assets',
        requestorId: 'users',
        approverId: 'users',
        campaignId: 'verification_campaigns',
        userId: 'users',
        reportedByUserId: 'users',
        receivedByUserId: 'users',
      };
      const col = map[field];
      if (!col) return;
      const val = row[field];
      if (val == null) return;
      const all = load(col);
      const found = all.find((x) => String(x._id) === String(val?._id || val));
      if (found) row[field] = clone(found);
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
      const rows = model._all();
      const idx = rows.findIndex((d) => match(d, filter));
      if (idx < 0) {
        if (opts.upsert) {
          const created = await model.create({ ...filter, ...(update.$set || update) });
          return created;
        }
        return null;
      }
      rows[idx] = applyUpdate(rows[idx], update);
      model._write(rows);
      return model._wrap(rows[idx]);
    },
    async findByIdAndUpdate(id, update, opts = {}) {
      return model.findOneAndUpdate({ _id: String(id) }, update, opts);
    },
    async create(doc) {
      const rows = model._all();
      const now = new Date().toISOString();
      const base = typeof defaults === 'function' ? defaults() : clone(defaults);
      const row = {
        ...base,
        ...clone(doc),
        _id: doc._id || oid(),
        createdAt: doc.createdAt || now,
        updatedAt: now,
      };
      rows.push(row);
      model._write(rows);
      return model._wrap(row);
    },
    async insertMany(docs) {
      const out = [];
      for (const d of docs) out.push(await model.create(d));
      return out;
    },
    async countDocuments(filter = {}) {
      return model._all().filter((d) => match(d, filter)).length;
    },
    async updateOne(filter, update) {
      const rows = model._all();
      const idx = rows.findIndex((d) => match(d, filter));
      if (idx < 0) return { matchedCount: 0, modifiedCount: 0 };
      rows[idx] = applyUpdate(rows[idx], update);
      model._write(rows);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async updateMany(filter, update) {
      const rows = model._all();
      let n = 0;
      for (let i = 0; i < rows.length; i++) {
        if (match(rows[i], filter)) {
          rows[i] = applyUpdate(rows[i], update);
          n += 1;
        }
      }
      model._write(rows);
      return { matchedCount: n, modifiedCount: n };
    },
    async deleteMany() {
      model._write([]);
    },
    async aggregate(pipeline = []) {
      let rows = model._all().map(clone);
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
      return rows;
    },
  };
  return model;
}

export function resetAllData() {
  for (const f of fs.readdirSync(dataDir)) {
    if (f.endsWith('.json')) fs.unlinkSync(path.join(dataDir, f));
  }
}
