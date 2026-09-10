import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configurePersistence,
  clearPersistenceCache,
  getCacheStats,
  isCacheableCollection,
  upsertDocument,
  deleteDocument,
  bulkUpsertDocuments,
} from './persistence.js';

function makeFakeMongo({ trackFullScans = true } = {}) {
  const docsByCol = new Map();
  let fullScans = 0;

  function rowsFor(name) {
    if (!docsByCol.has(name)) docsByCol.set(name, new Map());
    return docsByCol.get(name);
  }

  const db = {
    collection(name) {
      const logical = String(name || '').replace(/^tylo_/, '');
      return {
        async findOne(filter = {}) {
          const rows = rowsFor(logical);
          const id = filter?._id;
          if (id == null) return null;
          return rows.get(String(id)) || null;
        },
        async replaceOne(filter, plain) {
          rowsFor(logical).set(String(plain._id), { ...plain });
          return { acknowledged: true };
        },
        async deleteOne(filter = {}) {
          const rows = rowsFor(logical);
          const key = String(filter?._id ?? '');
          const had = rows.has(key);
          rows.delete(key);
          return { deletedCount: had ? 1 : 0 };
        },
        async bulkWrite(ops = []) {
          for (const op of ops) {
            if (op.replaceOne) {
              const plain = op.replaceOne.replacement;
              rowsFor(logical).set(String(plain._id), { ...plain });
            }
          }
          return { ok: 1 };
        },
        find(filter = {}) {
          const empty = !filter || Object.keys(filter).length === 0;
          if (trackFullScans && empty) fullScans += 1;
          const values = [...rowsFor(logical).values()];
          return {
            sort() { return this; },
            skip() { return this; },
            limit() { return this; },
            project() { return this; },
            async toArray() { return values.map((r) => ({ ...r })); },
          };
        },
        async countDocuments() {
          return rowsFor(logical).size;
        },
      };
    },
  };

  return {
    db,
    getFullScans: () => fullScans,
    getDoc: (col, id) => rowsFor(col).get(String(id)),
  };
}

test('audit_logs and geo_pin_codes are never-cache collections', () => {
  assert.equal(isCacheableCollection('audit_logs'), false);
  assert.equal(isCacheableCollection('geo_pin_codes'), false);
  assert.equal(isCacheableCollection('users'), true);
});

test('upsertDocument does not full-scan mongo to sync cache (login/audit path)', async () => {
  const fake = makeFakeMongo();
  configurePersistence({ backend: 'mongo', db: fake.db });
  clearPersistenceCache();

  await upsertDocument('audit_logs', {
    _id: 'audit-1',
    action: 'AUTH_LOGIN',
    actorEmail: 'a@example.com',
  });

  assert.equal(fake.getFullScans(), 0);
  assert.equal(getCacheStats().totalDocs, 0);
  assert.equal(fake.getDoc('audit_logs', 'audit-1')?.action, 'AUTH_LOGIN');
});

test('upsertDocument patches existing cache without reloading', async () => {
  const fake = makeFakeMongo();
  configurePersistence({ backend: 'mongo', db: fake.db });
  clearPersistenceCache();

  await upsertDocument('users', { _id: 'u1', name: 'Ada', email: 'a@x.com' });
  // First write should not hydrate; cache stays empty until an explicit load.
  assert.equal(getCacheStats().totalDocs, 0);

  // Simulate a prior hydrate.
  const { loadCollection } = await import('./persistence.js');
  await loadCollection('users');
  assert.equal(getCacheStats().totalDocs, 1);

  const beforeScans = fake.getFullScans();
  await upsertDocument('users', { _id: 'u1', name: 'Ada Lovelace' });
  assert.equal(fake.getFullScans(), beforeScans);
  assert.equal(fake.getDoc('users', 'u1')?.name, 'Ada Lovelace');
});

test('deleteDocument removes mongo row without full-scan', async () => {
  const fake = makeFakeMongo();
  configurePersistence({ backend: 'mongo', db: fake.db });
  clearPersistenceCache();

  await upsertDocument('audit_logs', { _id: 'audit-2', action: 'X' });
  const before = fake.getFullScans();
  const ok = await deleteDocument('audit_logs', 'audit-2');
  assert.equal(ok, true);
  assert.equal(fake.getFullScans(), before);
  assert.equal(fake.getDoc('audit_logs', 'audit-2'), undefined);
});

test('bulkUpsertDocuments for never-cache does not hydrate collection', async () => {
  const fake = makeFakeMongo();
  configurePersistence({ backend: 'mongo', db: fake.db });
  clearPersistenceCache();

  await bulkUpsertDocuments('geo_pin_codes', [
    { _id: 'pin-1', pinCode: '110001', districtId: 'd1' },
    { _id: 'pin-2', pinCode: '110002', districtId: 'd2' },
  ]);

  assert.equal(fake.getFullScans(), 0);
  assert.equal(getCacheStats().totalDocs, 0);
  assert.equal(fake.getDoc('geo_pin_codes', 'pin-1')?.pinCode, '110001');
});
