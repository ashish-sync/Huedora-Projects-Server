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

export function configurePersistence({ backend = 'file', dataDirectory, db } = {}) {
  mode = backend === 'mongo' ? 'mongo' : 'file';
  mongoDb = db || null;
  if (dataDirectory) dataDir = path.resolve(dataDirectory);
  fs.mkdirSync(dataDir, { recursive: true });
}

export async function hydratePersistence() {
  cache.clear();
  if (mode === 'mongo') {
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    const collections = await mongoDb.listCollections().toArray();
    const tyloCollections = collections.filter(({ name }) => name.startsWith('tylo_'));
    for (const { name } of tyloCollections) {
      const logicalName = name.slice('tylo_'.length);
      const rows = await mongoDb.collection(name).find({}).toArray();
      cache.set(logicalName, rows);
    }
    console.log(`[db] Hydrated ${tyloCollections.length} collection(s) from MongoDB`);
    return;
  }

  for (const file of fs.readdirSync(dataDir)) {
    if (!file.endsWith('.json')) continue;
    const logicalName = file.replace(/\.json$/, '');
    cache.set(logicalName, readFileCollection(logicalName));
  }
}

export async function loadCollection(name) {
  if (cache.has(name)) return clone(cache.get(name));
  if (mode === 'mongo') {
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    const rows = await mongoDb.collection(collectionKey(name)).find({}).toArray();
    cache.set(name, rows);
    return clone(rows);
  }
  const rows = readFileCollection(name);
  cache.set(name, rows);
  return clone(rows);
}

export async function saveCollection(name, rows) {
  const snapshot = clone(rows);
  cache.set(name, snapshot);
  if (mode === 'mongo') {
    if (!mongoDb) throw new Error('MongoDB persistence is not configured');
    const col = mongoDb.collection(collectionKey(name));
    const ids = snapshot.map((doc) => doc._id);
    if (ids.length) {
      await col.deleteMany({ _id: { $nin: ids } });
      await col.bulkWrite(
        snapshot.map((doc) => ({
          replaceOne: {
            filter: { _id: doc._id },
            replacement: doc,
            upsert: true,
          },
        })),
        { ordered: false },
      );
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
        .map(({ name }) => mongoDb.collection(name).drop().catch(() => {})),
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
