/**
 * Production-like memory stress: Camp One dashboard browsing + GPS/DF/PF uploads.
 *
 * Verifies the heap-retention fix without requiring mongod / MongoMemoryServer:
 *   - uses an in-process Mongo-compatible stub so filedb/persistence paths are real
 *   - seeds thousands of fat camp/asset docs (prod-like volume)
 *   - repeats dashboard aggregates + camp scans + GPS/DF/PF optimize
 *
 * Usage:
 *   node --expose-gc --max-old-space-size=384 scripts/stress-memory-camp-uploads.js
 *
 * Env:
 *   STRESS_CAMPS=2000 STRESS_ASSETS=800 STRESS_ROUNDS=5 STRESS_UPLOADS=3
 *   STRESS_HEAP_MAX_MB=250 STRESS_RSS_MAX_MB=450 STRESS_GROWTH_MAX_MB=40
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CAMPS = Math.max(100, Number(process.env.STRESS_CAMPS) || 2000);
const ASSETS = Math.max(50, Number(process.env.STRESS_ASSETS) || 800);
const ROUNDS = Math.max(2, Number(process.env.STRESS_ROUNDS) || 5);
const UPLOADS = Math.max(1, Number(process.env.STRESS_UPLOADS) || 3);
const HEAP_MAX = Number(process.env.STRESS_HEAP_MAX_MB) || 250;
const RSS_MAX = Number(process.env.STRESS_RSS_MAX_MB) || 450;
const GROWTH_MAX = Number(process.env.STRESS_GROWTH_MAX_MB) || 40;

function snap(label = '') {
  const m = process.memoryUsage();
  return {
    label,
    rssMb: +(m.rss / 1024 / 1024).toFixed(1),
    heapUsedMb: +(m.heapUsed / 1024 / 1024).toFixed(1),
    heapTotalMb: +(m.heapTotal / 1024 / 1024).toFixed(1),
  };
}

function gc() {
  if (typeof global.gc === 'function') {
    try {
      global.gc();
    } catch {
      /* ignore */
    }
  }
}

function logLine(tag, obj) {
  console.log(`[${tag}]`, typeof obj === 'string' ? obj : JSON.stringify(obj));
}

function matchSimple(doc, filter = {}) {
  if (!filter || !Object.keys(filter).length) return true;
  return Object.entries(filter).every(([key, val]) => {
    if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      if (Object.prototype.hasOwnProperty.call(val, '$ne')) {
        return doc[key] !== val.$ne;
      }
    }
    return doc[key] === val;
  });
}

function projectDoc(doc, projection) {
  if (!projection) return { ...doc };
  const out = { _id: doc._id };
  for (const [k, v] of Object.entries(projection)) {
    if (Number(v) === 1 && k !== '_id' && Object.prototype.hasOwnProperty.call(doc, k)) {
      out[k] = doc[k];
    }
  }
  return out;
}

/** Minimal Mongo collection stub used by persistence.js / scanCollection. */
function makeFakeMongo() {
  const docsByCol = new Map();

  function rows(name) {
    const logical = String(name || '').replace(/^tylo_/, '');
    if (!docsByCol.has(logical)) docsByCol.set(logical, []);
    return docsByCol.get(logical);
  }

  return {
    listCollections() {
      return {
        async toArray() {
          return [...docsByCol.keys()].map((name) => ({ name: `tylo_${name}` }));
        },
      };
    },
    collection(name) {
      const logical = String(name || '').replace(/^tylo_/, '');
      return {
        async insertMany(docs = []) {
          const arr = rows(logical);
          for (const d of docs) arr.push({ ...d });
          return { insertedCount: docs.length };
        },
        async findOne(filter = {}) {
          return rows(logical).find((d) => matchSimple(d, filter)) || null;
        },
        async replaceOne(filter, plain) {
          const arr = rows(logical);
          const idx = arr.findIndex((d) => String(d._id) === String(filter._id || plain._id));
          if (idx >= 0) arr[idx] = { ...plain };
          else arr.push({ ...plain });
          return { acknowledged: true };
        },
        async deleteOne() {
          return { deletedCount: 0 };
        },
        async bulkWrite() {
          return { ok: 1 };
        },
        async countDocuments(filter = {}) {
          return rows(logical).filter((d) => matchSimple(d, filter)).length;
        },
        find(filter = {}) {
          let values = rows(logical).filter((d) => matchSimple(d, filter));
          let projection = null;
          const api = {
            project(p) {
              projection = p;
              return api;
            },
            batchSize() {
              return api;
            },
            sort() {
              return api;
            },
            skip(n) {
              values = values.slice(Number(n) || 0);
              return api;
            },
            limit(n) {
              if (n != null) values = values.slice(0, Number(n));
              return api;
            },
            async toArray() {
              return values.map((d) => (projection ? projectDoc(d, projection) : { ...d }));
            },
            async *[Symbol.asyncIterator]() {
              for (const d of values) {
                yield projection ? projectDoc(d, projection) : { ...d };
              }
            },
          };
          return api;
        },
        aggregate(pipeline = []) {
          let values = [...rows(logical)];
          for (const stage of pipeline) {
            if (stage.$match) values = values.filter((d) => matchSimple(d, stage.$match));
            if (stage.$group) {
              const field = String(stage.$group._id || '').replace(/^\$/, '');
              const map = new Map();
              for (const r of values) {
                const key = r[field];
                const k = String(key);
                if (!map.has(k)) map.set(k, { _id: key, count: 0 });
                if (stage.$group.count?.$sum != null) {
                  map.get(k).count += Number(stage.$group.count.$sum) || 0;
                }
              }
              values = [...map.values()];
            }
          }
          return {
            async toArray() {
              return values;
            },
          };
        },
      };
    },
  };
}

async function makeJpeg(filePath, { width = 1200, height = 1600 } = {}) {
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 240, g: 236, b: 220 },
    },
  })
    .jpeg({ quality: 85 })
    .toFile(filePath);
}

async function makeWebp(filePath, { width = 960, height = 1280 } = {}) {
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 90, b: 140 },
    },
  })
    .webp({ lossless: true, effort: 1 })
    .toFile(filePath);
}

async function main() {
  process.env.MEMORY_LOG = 'true';
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';

  logLine('stress', `starting camps=${CAMPS} assets=${ASSETS} rounds=${ROUNDS} uploads/round=${UPLOADS}`);
  logLine('stress', `limits heap<=${HEAP_MAX}MB rss<=${RSS_MAX}MB growth<=${GROWTH_MAX}MB`);
  logLine('stress', `gc=${typeof global.gc === 'function' ? 'enabled' : 'disabled (re-run with --expose-gc)'}`);
  logLine('stress', 'backend=in-process fake mongo (real persistence/filedb/optimize paths)');

  const boot = snap('boot');
  logLine('memory', boot);

  const db = makeFakeMongo();
  const {
    configurePersistence,
    clearPersistenceCache,
    getCacheStats,
    hydratePersistence,
  } = await import('../src/store/persistence.js');
  const { defineCollection, scanCollection, invalidateIdIndex } = await import('../src/store/filedb.js');
  const { memorySnapshot } = await import('../src/utils/memory.js');

  configurePersistence({ backend: 'mongo', db });
  await hydratePersistence();
  clearPersistenceCache();
  invalidateIdIndex();

  const campCol = db.collection('tylo_camp_ops_camps');
  const assetCol = db.collection('tylo_assets');
  const CHUNK = 400;
  for (let i = 0; i < CAMPS; i += CHUNK) {
    const batch = [];
    const end = Math.min(CAMPS, i + CHUNK);
    for (let j = i; j < end; j += 1) {
      batch.push({
        _id: `camp-stress-${j}`,
        campId: `26-09-${String(j).padStart(4, '0')}`,
        status: j % 5 === 0 ? 'pending_review' : 'approved',
        lifecycleStage: ['request', 'assignment', 'execution', 'financial'][j % 4],
        isDeleted: false,
        clientId: `client-${j % 40}`,
        clientName: `Client ${j % 40}`,
        campaignId: `campn-${j % 20}`,
        campaignName: `Campaign ${j % 20}`,
        campaignType: j % 2 ? 'MOM' : 'DIALYSIS',
        state: ['Delhi', 'Maharashtra', 'Karnataka'][j % 3],
        city: `City-${j % 50}`,
        campDate: `2026-09-${String((j % 28) + 1).padStart(2, '0')}`,
        startTime: '09:00',
        endTime: '13:00',
        doctorName: `Dr Stress ${j % 100}`,
        notes: 'x'.repeat(400),
        executionDocuments: [
          {
            id: `doc-${j}-a`,
            docType: 'gps_selfie',
            fileName: `gps-${j}.webp`,
            url: `/uploads/camp-ops/gps-${j}.webp`,
            meta: { pad: 'y'.repeat(200) },
          },
          {
            id: `doc-${j}-b`,
            docType: 'doctor_form',
            fileName: `df-${j}.webp`,
            url: `/uploads/camp-ops/df-${j}.webp`,
            meta: { pad: 'z'.repeat(200) },
          },
        ],
        purchaseOrders: [{ id: `po-${j}`, poNumber: `PO${j}`, poNetValue: 1000 + j }],
      });
    }
    await campCol.insertMany(batch);
  }
  for (let i = 0; i < ASSETS; i += CHUNK) {
    const batch = [];
    const end = Math.min(ASSETS, i + CHUNK);
    for (let j = i; j < end; j += 1) {
      batch.push({
        _id: `asset-stress-${j}`,
        serialNumber: `SN-${j}`,
        status: j % 3 === 0 ? 'Deployed' : 'Available',
        isDeleted: false,
        name: `Device ${j}`,
        notes: 'n'.repeat(120),
      });
    }
    await assetCol.insertMany(batch);
  }
  gc();

  const afterSeed = snap('after-seed');
  logLine('memory', afterSeed);
  logLine('memory:cache', getCacheStats());

  const Camp = defineCollection('camp_ops_camps');
  const Asset = defineCollection('assets');
  const { optimizeGpsSelfieFile } = await import('../src/storage/media/optimizeGpsSelfie.js');
  const { optimizeExecutionDocumentFile } = await import('../src/storage/media/optimizeExecutionDoc.js');

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-stress-'));
  const samples = {
    gpsWebp: path.join(workDir, 'gps.webp'),
    gpsJpeg: path.join(workDir, 'gps.jpg'),
    doctor: path.join(workDir, 'doctor.jpg'),
    patient: path.join(workDir, 'patient.jpg'),
  };
  await makeWebp(samples.gpsWebp);
  await makeJpeg(samples.gpsJpeg, { width: 1100, height: 1400 });
  await makeJpeg(samples.doctor, { width: 1400, height: 1800 });
  await makeJpeg(samples.patient, { width: 1400, height: 1800 });

  const timeline = [];
  let peakRss = afterSeed.rssMb;
  let peakHeap = afterSeed.heapUsedMb;
  let maxCacheDocs = getCacheStats().totalDocs || 0;

  function record(label) {
    gc();
    const mem = memorySnapshot(label);
    const cache = getCacheStats();
    const row = {
      label,
      rssMb: mem.rssMb,
      heapUsedMb: mem.heapUsedMb,
      totalDocs: cache.totalDocs,
      collections: cache.collections?.slice(0, 8) || [],
    };
    timeline.push(row);
    peakRss = Math.max(peakRss, row.rssMb);
    peakHeap = Math.max(peakHeap, row.heapUsedMb);
    maxCacheDocs = Math.max(maxCacheDocs, row.totalDocs || 0);
    logLine('memory', row);
    logLine('memory:cache', {
      totalDocs: cache.totalDocs,
      collections: cache.collections?.slice(0, 8),
    });
    return row;
  }

  const baseline = record('baseline-after-seed-gc');

  async function browseDashboards() {
    await Camp.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    await Camp.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$lifecycleStage', count: { $sum: 1 } } },
    ]);
    await Asset.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    let scanned = 0;
    await scanCollection('camp_ops_camps', {
      filter: { isDeleted: false },
      projection: {
        status: 1,
        clientId: 1,
        campaignId: 1,
        campaignName: 1,
        clientName: 1,
        state: 1,
        campaignType: 1,
        campDate: 1,
        lifecycleStage: 1,
      },
      forEach: () => {
        scanned += 1;
      },
    });
    return scanned;
  }

  async function runUploads(round) {
    for (let u = 0; u < UPLOADS; u += 1) {
      const gpsLight = await optimizeGpsSelfieFile(samples.gpsWebp, { lightOnly: true });
      if (gpsLight.filePath && gpsLight.filePath !== samples.gpsWebp) {
        try {
          fs.unlinkSync(gpsLight.filePath);
        } catch {
          /* ignore */
        }
      }

      const gpsFull = await optimizeGpsSelfieFile(samples.gpsJpeg, { lightOnly: false });
      if (gpsFull.filePath) {
        try {
          fs.unlinkSync(gpsFull.filePath);
        } catch {
          /* ignore */
        }
      }

      const df = await optimizeExecutionDocumentFile(samples.doctor, {
        originalName: `doctor-r${round}-${u}.jpg`,
        mimetype: 'image/jpeg',
      });
      if (df?.filePath) {
        try {
          fs.unlinkSync(df.filePath);
        } catch {
          /* ignore */
        }
      }

      const pf = await optimizeExecutionDocumentFile(samples.patient, {
        originalName: `patient-r${round}-${u}.jpg`,
        mimetype: 'image/jpeg',
      });
      if (pf?.filePath) {
        try {
          fs.unlinkSync(pf.filePath);
        } catch {
          /* ignore */
        }
      }
    }
  }

  for (let round = 1; round <= ROUNDS; round += 1) {
    logLine('stress', `round ${round}/${ROUNDS} browse`);
    const scanned = await browseDashboards();
    record(`round-${round}-after-browse`);
    logLine('stress', `scanned camps=${scanned}`);

    logLine('stress', `round ${round}/${ROUNDS} uploads x${UPLOADS} (gps+df+pf)`);
    await runUploads(round);
    record(`round-${round}-after-uploads`);
  }

  gc();
  await new Promise((r) => setTimeout(r, 200));
  const end = record('final');

  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  const growth = +(end.heapUsedMb - baseline.heapUsedMb).toFixed(1);
  const heavyCached = (end.collections || []).filter((c) =>
    ['camp_ops_camps', 'assets', 'contacts', 'movements', 'agreements'].includes(c.name),
  );

  const failures = [];
  if (maxCacheDocs > 50) {
    failures.push(
      `cache totalDocs peaked at ${maxCacheDocs} (want low / near 0 for never-cache path)`,
    );
  }
  if (heavyCached.length) {
    failures.push(
      `heavy collections retained in cache: ${heavyCached.map((c) => `${c.name}:${c.count}`).join(',')}`,
    );
  }
  if (peakHeap > HEAP_MAX) {
    failures.push(`peak heapUsed ${peakHeap}MB exceeds ${HEAP_MAX}MB`);
  }
  if (peakRss > RSS_MAX) {
    failures.push(`peak RSS ${peakRss}MB exceeds ${RSS_MAX}MB (Render ceiling 512)`);
  }
  if (growth > GROWTH_MAX) {
    failures.push(
      `cumulative heap growth ${growth}MB exceeds ${GROWTH_MAX}MB (baseline ${baseline.heapUsedMb} → end ${end.heapUsedMb})`,
    );
  }

  console.log('\n=== Memory stress summary ===');
  console.log(
    JSON.stringify(
      {
        boot,
        baseline,
        end,
        peakRssMb: peakRss,
        peakHeapUsedMb: peakHeap,
        maxCacheTotalDocs: maxCacheDocs,
        heapGrowthMb: growth,
        rounds: ROUNDS,
        camps: CAMPS,
        assets: ASSETS,
        uploadsPerRound: UPLOADS,
        timeline,
      },
      null,
      2,
    ),
  );

  if (failures.length) {
    console.error('\nFAIL:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }

  console.log('\nPASS: no cumulative retention; heap/RSS within budgets; cache stayed low.');
}

main().catch((err) => {
  console.error('[stress] fatal:', err);
  process.exitCode = 1;
});
