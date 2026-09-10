/**
 * Regression: Model.aggregate / scanCollection must not retain full collections
 * in the process cache (Render heap growth before Sharp).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configurePersistence,
  clearPersistenceCache,
  getCacheStats,
  isCacheableCollection,
  aggregateCollection,
} from './persistence.js';
import { defineCollection, scanCollection, invalidateIdIndex } from './filedb.js';

function makeFakeMongo(seed = {}) {
  const docsByCol = new Map();
  for (const [name, rows] of Object.entries(seed)) {
    docsByCol.set(name, rows.map((r) => ({ ...r })));
  }
  let fullScans = 0;

  const db = {
    collection(name) {
      const logical = String(name || '').replace(/^tylo_/, '');
      return {
        async findOne(filter = {}) {
          const rows = docsByCol.get(logical) || [];
          return rows.find((r) => String(r._id) === String(filter._id)) || null;
        },
        async replaceOne(_filter, plain) {
          const rows = docsByCol.get(logical) || [];
          const idx = rows.findIndex((r) => String(r._id) === String(plain._id));
          if (idx >= 0) rows[idx] = { ...plain };
          else rows.push({ ...plain });
          docsByCol.set(logical, rows);
          return { acknowledged: true };
        },
        async bulkWrite() { return { ok: 1 }; },
        async deleteOne() { return { deletedCount: 0 }; },
        find(filter = {}) {
          const empty = !filter || Object.keys(filter).length === 0;
          if (empty) fullScans += 1;
          let values = [...(docsByCol.get(logical) || [])];
          if (filter?.isDeleted === false) {
            values = values.filter((r) => !r.isDeleted);
          }
          const api = {
            project() { return api; },
            batchSize() { return api; },
            sort() { return api; },
            skip() { return api; },
            limit() { return api; },
            async toArray() { return values.map((r) => ({ ...r })); },
            async *[Symbol.asyncIterator]() {
              for (const row of values) yield { ...row };
            },
          };
          return api;
        },
        async countDocuments(filter = {}) {
          let values = docsByCol.get(logical) || [];
          if (filter?.isDeleted === false) values = values.filter((r) => !r.isDeleted);
          return values.length;
        },
        aggregate(pipeline = []) {
          let rows = [...(docsByCol.get(logical) || [])];
          for (const stage of pipeline) {
            if (stage.$match?.isDeleted === false) {
              rows = rows.filter((r) => !r.isDeleted);
            }
            if (stage.$match?.isActive === true) {
              rows = rows.filter((r) => r.isActive);
            }
            if (stage.$group) {
              const field = String(stage.$group._id || '').replace(/^\$/, '');
              const map = new Map();
              for (const r of rows) {
                const key = r[field];
                const k = String(key);
                if (!map.has(k)) map.set(k, { _id: key, count: 0 });
                map.get(k).count += 1;
              }
              rows = [...map.values()];
            }
          }
          return {
            async toArray() { return rows; },
          };
        },
      };
    },
  };

  return { db, getFullScans: () => fullScans };
}

test('heavy operational collections are never-cache', () => {
  assert.equal(isCacheableCollection('camp_ops_camps'), false);
  assert.equal(isCacheableCollection('assets'), false);
  assert.equal(isCacheableCollection('contacts'), false);
  assert.equal(isCacheableCollection('roles'), true);
});

test('Model.aggregate uses mongo pushdown and does not retain cache', async () => {
  const camps = [
    { _id: 'c1', status: 'approved', isDeleted: false },
    { _id: 'c2', status: 'approved', isDeleted: false },
    { _id: 'c3', status: 'pending_review', isDeleted: false },
  ];
  const fake = makeFakeMongo({ camp_ops_camps: camps, assets: [
    { _id: 'a1', status: 'Available', isDeleted: false },
    { _id: 'a2', status: 'Deployed', isDeleted: false },
  ] });
  configurePersistence({ backend: 'mongo', db: fake.db });
  clearPersistenceCache();
  invalidateIdIndex();

  const Camp = defineCollection('camp_ops_camps');
  const Asset = defineCollection('assets');

  const byStatus = await Camp.aggregate([
    { $match: { isDeleted: false } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  assert.ok(Array.isArray(byStatus));
  assert.equal(byStatus.find((r) => r._id === 'approved')?.count, 2);

  const assetRows = await Asset.aggregate([
    { $match: { isDeleted: false } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  assert.equal(assetRows.find((r) => r._id === 'Available')?.count, 1);

  assert.equal(getCacheStats().totalDocs, 0, 'aggregate must not hydrate process cache');
});

test('scanCollection streams without retaining cache', async () => {
  const camps = Array.from({ length: 50 }, (_, i) => ({
    _id: `camp-${i}`,
    status: i % 2 ? 'approved' : 'pending_review',
    isDeleted: false,
    clientId: 'cl1',
  }));
  const fake = makeFakeMongo({ camp_ops_camps: camps });
  configurePersistence({ backend: 'mongo', db: fake.db });
  clearPersistenceCache();
  invalidateIdIndex();

  let seen = 0;
  const n = await scanCollection('camp_ops_camps', {
    filter: { isDeleted: false },
    projection: { status: 1 },
    forEach: () => { seen += 1; },
  });
  assert.equal(n, 50);
  assert.equal(seen, 50);
  assert.equal(getCacheStats().totalDocs, 0);
});

test('aggregateCollection returns grouped counts', async () => {
  const fake = makeFakeMongo({
    geo_pin_codes: [
      { _id: '1', stateId: 's1', isDeleted: false, isActive: true },
      { _id: '2', stateId: 's1', isDeleted: false, isActive: true },
      { _id: '3', stateId: 's2', isDeleted: false, isActive: true },
    ],
  });
  configurePersistence({ backend: 'mongo', db: fake.db });
  const rows = await aggregateCollection('geo_pin_codes', [
    { $match: { isDeleted: false, isActive: true } },
    { $group: { _id: '$stateId', count: { $sum: 1 } } },
  ]);
  assert.equal(rows.find((r) => r._id === 's1')?.count, 2);
});
