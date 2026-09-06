import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('execution-doc R2 confirmation helpers', () => {
  let uploadsRoot;
  let previousUploadsDir;

  before(() => {
    uploadsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-r2-confirm-'));
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

  it('putLocalMasterToR2 marks ready when object store is disabled (local confirm)', async () => {
    const { putLocalMasterToR2 } = await import('./storedFileRegistry.js');
    const { absoluteUploadPath } = await import('../uploadKeys.js');
    const key = `camp-ops/confirm-${Date.now()}.webp`;
    const abs = absoluteUploadPath(key);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from('webp-bytes'));

    const result = await putLocalMasterToR2(key, {
      contentType: 'image/webp',
      originalName: 'ADIDF.webp',
      retries: 1,
      verify: false,
    });
    assert.equal(result.skipped, true);

    const { StoredFile } = await import('../../modules/files/storedFile.model.js');
    const row = await StoredFile.findOne({ objectKey: key, isDeleted: false });
    assert.equal(row?.status, 'ready');
  });

  it('renameLocalUpload with deferR2 false migrates registry to final key', async () => {
    const { upsertStoredFile } = await import('./storedFileRegistry.js');
    const { renameLocalUpload } = await import('../persistUpload.js');
    const { absoluteUploadPath } = await import('../uploadKeys.js');
    const { StoredFile } = await import('../../modules/files/storedFile.model.js');

    const fromKey = `camp-ops/tmp-rename-${Date.now()}.webp`;
    const toKey = `camp-ops/26-10-0001__ADIPF.webp`;
    const fromAbs = absoluteUploadPath(fromKey);
    const toAbs = absoluteUploadPath(toKey);
    fs.mkdirSync(path.dirname(fromAbs), { recursive: true });
    fs.writeFileSync(fromAbs, Buffer.from('pf-bytes'));

    await upsertStoredFile({
      objectKey: fromKey,
      status: 'pending',
      contentType: 'image/webp',
      originalName: 'scan.webp',
    });

    await renameLocalUpload(fromAbs, toAbs, {
      contentType: 'image/webp',
      deferR2: false,
      originalName: 'ADIPF.webp',
    });

    assert.equal(fs.existsSync(toAbs), true);
    assert.equal(fs.existsSync(fromAbs), false);

    const moved = await StoredFile.findOne({ objectKey: toKey, isDeleted: false });
    assert.ok(moved);
    assert.equal(moved.status, 'ready');
    assert.equal(moved.originalName, 'ADIPF.webp');

    const old = await StoredFile.findOne({ objectKey: fromKey, isDeleted: false });
    assert.equal(old, null);
  });
});
