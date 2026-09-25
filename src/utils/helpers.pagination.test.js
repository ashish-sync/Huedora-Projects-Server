import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePagination } from './helpers.js';

test('parsePagination defaults maxLimit to 100', () => {
  const p = parsePagination({ page: 1, limit: 9999 });
  assert.equal(p.limit, 100);
});

test('parsePagination respects custom maxLimit up to hard max 2000', () => {
  assert.equal(parsePagination({ limit: 3000 }, { maxLimit: 2000 }).limit, 2000);
  assert.equal(parsePagination({ limit: 3000 }, { maxLimit: 5000 }).limit, 2000);
  assert.equal(parsePagination({ limit: 50 }, { maxLimit: 2000 }).limit, 50);
});
