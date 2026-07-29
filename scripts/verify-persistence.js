/**
 * Verifies that all application CRUD goes through the MongoDB/file persistence layer.
 * Run: node scripts/verify-persistence.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// Use file-backed persistence for local verification (no Atlas / memory server required).
process.env.USE_MONGOOSE = 'false';
process.env.USE_MEMORY_DB = 'false';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, '../src');

const FORBIDDEN_PATTERNS = [
  { re: /readFileSync\([^)]*\/data\//, label: 'direct readFileSync on server/data' },
  { re: /writeFileSync\([^)]*\/data\//, label: 'direct writeFileSync on server/data' },
  { re: /\.email-ingest-since\.json/, label: 'legacy email ingest JSON file' },
];

async function importAllModels() {
  const models = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.model.js')) models.push(full);
    }
  }
  walk(srcRoot);
  for (const file of models) {
    await import(pathToFileURL(file).href);
  }
  return models.length;
}

function scanSourceForBypasses() {
  const issues = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        if (full.includes(`${path.sep}store${path.sep}persistence.js`)) continue;
        if (full.includes(`${path.sep}geo${path.sep}seed`)) continue;
        if (full.includes('buildIndiaGeoSeed')) continue;
        if (full.endsWith(`${path.sep}emailIngestSince.js`)) continue;
        const text = fs.readFileSync(full, 'utf8');
        for (const { re, label } of FORBIDDEN_PATTERNS) {
          if (re.test(text)) issues.push({ file: path.relative(srcRoot, full), label });
        }
      }
    }
  }
  walk(srcRoot);
  return issues;
}

async function crudRoundTrip(defineCollection) {
  const Model = defineCollection('__verify_roundtrip');
  const id = `verify-${Date.now()}`;
  await Model.create({ _id: id, probe: true });
  const found = await Model.findById(id);
  if (!found) throw new Error('create/find failed');
  await Model.findByIdAndUpdate(id, { $set: { probe: false } });
  const updated = await Model.findById(id);
  const obj = updated?.toObject ? updated.toObject() : updated;
  if (!obj || obj.probe !== false) throw new Error('update failed');
  await Model.deleteMany({ _id: id });
  const count = await Model.countDocuments({ _id: id });
  if (count !== 0) throw new Error('delete failed');
}

async function main() {
  const modelFiles = await importAllModels();
  const bypasses = scanSourceForBypasses();

  console.log(`[verify] Loaded ${modelFiles} model file(s)`);
  if (bypasses.length) {
    console.error('[verify] FAIL — persistence bypasses found:');
    for (const issue of bypasses) {
      console.error(`  - ${issue.file}: ${issue.label}`);
    }
    process.exit(1);
  }
  console.log('[verify] No forbidden local JSON data paths in src/');

  const { connectDb, disconnectDb, getDbInfo } = await import('../src/config/db.js');
  const { getRegisteredCollections, defineCollection } = await import('../src/store/filedb.js');
  const { getPersistenceMode } = await import('../src/store/persistence.js');

  await connectDb();
  const db = getDbInfo();
  const collections = getRegisteredCollections();
  console.log(`[verify] Persistence mode: ${getPersistenceMode()} (mongoose=${db.useMongoose})`);
  console.log(`[verify] Registered collections: ${collections.length}`);
  console.log(`[verify] Collections: ${collections.join(', ')}`);

  const expected = [
    'users', 'contacts', 'device_masters', 'assets', 'agreements',
    'asset_requests', 'logistics_products', 'camp_ops_camps', 'documents', 'geo_states',
  ];
  const missing = expected.filter((name) => !collections.includes(name));
  if (missing.length) {
    console.warn(`[verify] WARN: expected collections not registered: ${missing.join(', ')}`);
  }

  await crudRoundTrip(defineCollection);
  console.log('[verify] CRUD round-trip OK');

  await disconnectDb();
  console.log('[verify] PASS — all checks succeeded');
}

main().catch((err) => {
  console.error('[verify] FAIL', err);
  process.exit(1);
});
