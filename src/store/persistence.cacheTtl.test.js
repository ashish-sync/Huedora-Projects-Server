import test from 'node:test';
import assert from 'node:assert/strict';
import { getMongoCollectionCacheTtlMs } from './persistence.js';

test('mongo collection cache TTL defaults to 0 (single-replica hold)', () => {
  const prev = process.env.MONGO_COLLECTION_CACHE_TTL_MS;
  delete process.env.MONGO_COLLECTION_CACHE_TTL_MS;
  assert.equal(getMongoCollectionCacheTtlMs(), 0);
  process.env.MONGO_COLLECTION_CACHE_TTL_MS = '5000';
  assert.equal(getMongoCollectionCacheTtlMs(), 5000);
  if (prev === undefined) delete process.env.MONGO_COLLECTION_CACHE_TTL_MS;
  else process.env.MONGO_COLLECTION_CACHE_TTL_MS = prev;
});
