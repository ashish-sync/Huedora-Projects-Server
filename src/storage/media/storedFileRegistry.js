import fs from 'fs';
import { StoredFile } from '../../modules/files/storedFile.model.js';
import { assignPreservingExisting } from '../../store/dataIntegrity.js';
import { toUploadObjectKey, absoluteUploadPath } from '../uploadKeys.js';
import { isObjectStoreEnabled, putLocalFile, headObject, R2_STORAGE_STANDARD } from '../objectStore.js';

/**
 * Upsert stored_files row. Use status `pending` while R2 put is deferred/in-flight.
 */
export async function upsertStoredFile(patch = {}) {
  const key = String(patch.objectKey || '').trim();
  if (!key) throw new Error('objectKey required');
  let row = await StoredFile.findOne({ objectKey: key, isDeleted: false });
  if (!row) {
    return StoredFile.create({
      objectKey: key,
      refCount: 1,
      lastAccessedAt: new Date().toISOString(),
      ...patch,
    });
  }
  assignPreservingExisting(row, patch, { clearKeys: ['lastError'] });
  await row.save();
  return row;
}

/**
 * After a local rename, move registry from fromKey → toKey.
 * Defaults to pending when R2 is enabled (caller enqueues put); pass status:'ready' after sync put.
 */
export async function migrateStoredFileKey(fromKey, toKey, extras = {}) {
  const from = String(fromKey || '').trim();
  const to = String(toKey || '').trim();
  if (!to) throw new Error('toKey required');

  const defaultStatus = isObjectStoreEnabled() ? 'pending' : 'ready';
  const status = extras.status || defaultStatus;
  const { status: _ignore, ...rest } = extras;

  if (!from || from === to) {
    return upsertStoredFile({
      objectKey: to,
      status,
      lastError: status === 'ready' ? '' : undefined,
      ...rest,
    });
  }

  const source = await StoredFile.findOne({ objectKey: from, isDeleted: false });
  const dest = await StoredFile.findOne({ objectKey: to, isDeleted: false });

  if (source && dest && String(source._id) !== String(dest._id)) {
    assignPreservingExisting(
      dest,
      {
        contentHash: source.contentHash || dest.contentHash,
        kind: source.kind || dest.kind,
        contentType: rest.contentType || source.contentType || dest.contentType,
        sizeBytes: rest.sizeBytes ?? source.sizeBytes ?? dest.sizeBytes,
        originalName: rest.originalName || source.originalName || dest.originalName,
        status,
        storageClass: R2_STORAGE_STANDARD,
        lastError: status === 'ready' ? '' : dest.lastError,
        lastAccessedAt: new Date().toISOString(),
        ...rest,
      },
      { clearKeys: status === 'ready' ? ['lastError'] : [] },
    );
    await dest.save();
    source.isDeleted = true;
    await source.save();
    return dest;
  }

  if (source) {
    source.objectKey = to;
    source.status = status;
    if (status === 'ready') source.lastError = '';
    source.storageClass = R2_STORAGE_STANDARD;
    source.lastAccessedAt = new Date().toISOString();
    if (rest.contentType) source.contentType = rest.contentType;
    if (rest.originalName) source.originalName = rest.originalName;
    if (rest.sizeBytes != null) source.sizeBytes = rest.sizeBytes;
    await source.save();
    return source;
  }

  return upsertStoredFile({
    objectKey: to,
    status,
    lastError: status === 'ready' ? '' : '',
    storageClass: R2_STORAGE_STANDARD,
    ...rest,
  });
}

/** Mark a registry row failed (creates row if missing so failures are never silent). */
export async function markStoredFileFailed(objectKey, err, { attempts, originalName, contentType } = {}) {
  const key = String(objectKey || '').trim();
  if (!key) {
    console.error('[media] markStoredFileFailed called without objectKey:', err?.message || err);
    return null;
  }
  const message = String(err?.message || err || 'R2 put failed').slice(0, 500);
  let row = await StoredFile.findOne({ objectKey: key, isDeleted: false });
  if (!row) {
    row = await StoredFile.create({
      objectKey: key,
      originalName: originalName || '',
      contentType: contentType || '',
      status: 'failed',
      lastError: message,
      processAttempts: Number(attempts) || 1,
      lastAccessedAt: new Date().toISOString(),
    });
  } else {
    row.status = 'failed';
    row.lastError = message;
    if (attempts != null) row.processAttempts = Number(attempts);
    await row.save();
  }
  console.error(`[media] stored_files marked failed key=${key}: ${message}`);
  return row;
}

export async function markStoredFileReady(objectKey, extras = {}) {
  const key = String(objectKey || '').trim();
  if (!key) return null;
  return upsertStoredFile({
    objectKey: key,
    status: 'ready',
    lastError: '',
    storageClass: R2_STORAGE_STANDARD,
    processedAt: new Date().toISOString(),
    ...extras,
  });
}

/**
 * Counts for admin surfacing.
 */
export async function storedFileStatusCounts() {
  const rows = await StoredFile.find({ isDeleted: false });
  const list = Array.isArray(rows) ? rows : [];
  const counts = { pending: 0, failed: 0, ready: 0, archived: 0, other: 0, total: list.length };
  for (const row of list) {
    const s = String(row.status || 'other');
    if (counts[s] != null) counts[s] += 1;
    else counts.other += 1;
  }
  return counts;
}

/**
 * Put local master to R2 and mark ready (used by retry + r2Put job + sync confirm).
 * Retries with backoff; optional HeadObject verify so PutObject "success" without object is caught.
 */
export async function putLocalMasterToR2(
  objectKey,
  { contentType, originalName, retries = 2, verify = true } = {},
) {
  const key = toUploadObjectKey(objectKey);
  if (!key) throw new Error('Invalid objectKey for R2 put');
  if (!isObjectStoreEnabled()) {
    await markStoredFileReady(key, { originalName, contentType });
    return { skipped: true, key };
  }
  const abs = absoluteUploadPath(key);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error(`Local master missing for R2 put: ${key}`);
  }

  const attempts = Math.max(1, Number(retries) || 2);
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await putLocalFile(abs, key, {
        contentType: contentType || 'application/octet-stream',
        storageClass: R2_STORAGE_STANDARD,
      });
      if (verify) {
        const head = await headObject(key);
        if (!head) {
          throw new Error(`R2 HeadObject missing after PutObject for ${key}`);
        }
      }
      await markStoredFileReady(key, {
        originalName,
        contentType,
        sizeBytes: fs.statSync(abs).size,
      });
      return { ok: true, key, attempts: attempt };
    } catch (err) {
      lastErr = err;
      console.error(
        `[media] R2 put attempt ${attempt}/${attempts} failed key=${key}: ${err?.message || err}`,
      );
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, 200 * 2 ** (attempt - 1)));
      }
    }
  }

  await markStoredFileFailed(key, lastErr, {
    attempts,
    originalName,
    contentType,
  });
  throw lastErr || new Error(`R2 put failed for ${key}`);
}
