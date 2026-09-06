import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  configurePersistence,
  queryCollection,
  upsertDocument,
  getPersistenceMode,
} from './persistence.js';

describe('queryCollection file-mode fallback', () => {
  let dir;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-qc-'));
    configurePersistence({ backend: 'file', dataDirectory: dir });
    assert.equal(getPersistenceMode(), 'file');
    await upsertDocument('perf_test_camps', {
      _id: 'a',
      isDeleted: false,
      campDate: '2026-01-01',
      name: 'A',
    });
    await upsertDocument('perf_test_camps', {
      _id: 'b',
      isDeleted: false,
      campDate: '2026-02-01',
      name: 'B',
    });
    await upsertDocument('perf_test_camps', {
      _id: 'c',
      isDeleted: true,
      campDate: '2026-03-01',
      name: 'C',
    });
  });

  after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('filters, sorts, skips, and limits without returning deleted rows', async () => {
    const { data, total } = await queryCollection('perf_test_camps', {
      filter: { isDeleted: false },
      sort: { campDate: 1 },
      skip: 1,
      limit: 1,
    });
    assert.equal(total, 2);
    assert.equal(data.length, 1);
    assert.equal(data[0]._id, 'b');
  });
});
