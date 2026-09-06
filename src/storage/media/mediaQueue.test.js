import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('media queue R2 failure surfacing', () => {
  let uploadsRoot;
  let previousUploadsDir;

  before(() => {
    uploadsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-media-q-'));
    previousUploadsDir = process.env.UPLOADS_DIR;
    process.env.UPLOADS_DIR = uploadsRoot;
  });

  after(() => {
    if (previousUploadsDir == null) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousUploadsDir;
    try {
      fs.rmSync(uploadsRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('markStoredFileFailed creates a failed row when none exists', async () => {
    const { markStoredFileFailed } = await import('./storedFileRegistry.js');
    const { StoredFile } = await import('../../modules/files/storedFile.model.js');
    const key = `camp-ops/test-fail-${Date.now()}.webp`;
    const row = await markStoredFileFailed(key, new Error('R2 timeout'), {
      attempts: 3,
      originalName: 'ADIPF.webp',
      contentType: 'image/webp',
    });
    assert.equal(row.status, 'failed');
    assert.match(row.lastError, /R2 timeout/);
    assert.equal(row.processAttempts, 3);

    const found = await StoredFile.findOne({ objectKey: key, isDeleted: false });
    assert.equal(found?.status, 'failed');
  });

  it('migrateStoredFileKey moves pending registry to the final key', async () => {
    const { migrateStoredFileKey, upsertStoredFile } = await import('./storedFileRegistry.js');
    const { StoredFile } = await import('../../modules/files/storedFile.model.js');
    const from = `camp-ops/tmp-${Date.now()}.webp`;
    const to = `camp-ops/26-10-0001__ADIPF.webp`;
    await upsertStoredFile({
      objectKey: from,
      status: 'pending',
      originalName: 'scan.webp',
      contentType: 'image/webp',
      sizeBytes: 12,
    });
    const moved = await migrateStoredFileKey(from, to, {
      originalName: 'ADIPF.webp',
      contentType: 'image/webp',
      status: 'pending',
    });
    assert.equal(moved.objectKey, to);
    assert.equal(moved.status, 'pending');
    assert.equal(moved.originalName, 'ADIPF.webp');

    const old = await StoredFile.findOne({ objectKey: from, isDeleted: false });
    assert.equal(old, null);
  });

  it('retryFailedMediaJobs marks failed when local master is missing', async () => {
    const { upsertStoredFile } = await import('./storedFileRegistry.js');
    const { retryFailedMediaJobs } = await import('./mediaQueue.js');
    const key = `camp-ops/missing-local-${Date.now()}.webp`;
    await upsertStoredFile({
      objectKey: key,
      status: 'failed',
      lastError: 'prior',
      contentType: 'image/webp',
    });
    const result = await retryFailedMediaJobs({ limit: 100, includePending: false });
    assert.ok(result.attempted >= 1);
    const hit = (result.errors || []).find((e) => e.objectKey === key);
    assert.ok(hit, 'expected error entry for missing local master');
    assert.match(hit.error, /Local master missing/i);
  });
});
