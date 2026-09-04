import fs from 'fs';
import path from 'path';
import { isObjectStoreEnabled, putLocalFile, putBuffer, deleteObject } from './objectStore.js';
import { toUploadObjectKey, absoluteUploadPath } from './uploadKeys.js';

/**
 * After a file lands on local disk, mirror it to R2 when enabled.
 * No-op when R2 is disabled. Throws if R2 is enabled and upload fails.
 */
export async function persistLocalUploadToR2(absPath, { contentType } = {}) {
  if (!isObjectStoreEnabled()) return { skipped: true };
  const key = toUploadObjectKey(absPath);
  if (!key) {
    throw new Error(`Cannot map upload path to R2 key: ${absPath}`);
  }
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    throw new Error(`Local upload missing before R2 persist: ${absPath}`);
  }
  return putLocalFile(absPath, key, { contentType });
}

/**
 * Write buffer to disk under uploads and mirror to R2.
 * @returns {{ absPath: string, objectKey: string }}
 */
export async function writeUploadBuffer(objectKey, buffer, { contentType } = {}) {
  const key = toUploadObjectKey(objectKey);
  if (!key) throw new Error('Invalid upload object key');
  const absPath = absoluteUploadPath(key);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, buffer);
  if (isObjectStoreEnabled()) {
    await putBuffer(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), key, { contentType });
  }
  return { absPath, objectKey: key };
}

/**
 * Rename/move within uploads root and keep R2 in sync.
 */
export async function renameLocalUpload(fromAbs, toAbs, { contentType } = {}) {
  fs.mkdirSync(path.dirname(toAbs), { recursive: true });
  if (fromAbs !== toAbs) {
    fs.renameSync(fromAbs, toAbs);
  }
  const toKey = toUploadObjectKey(toAbs);
  const fromKey = toUploadObjectKey(fromAbs);
  if (isObjectStoreEnabled() && toKey) {
    await putLocalFile(toAbs, toKey, { contentType });
    if (fromKey && fromKey !== toKey) {
      await deleteObject(fromKey).catch(() => {});
    }
  }
  return { absPath: toAbs, objectKey: toKey };
}

/**
 * Copy a local file into uploads (or within uploads) and persist to R2.
 */
export async function copyLocalUpload(srcAbs, destAbs, { contentType } = {}) {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.copyFileSync(srcAbs, destAbs);
  if (isObjectStoreEnabled()) {
    const key = toUploadObjectKey(destAbs);
    if (key) await putLocalFile(destAbs, key, { contentType });
  }
  return { absPath: destAbs, objectKey: toUploadObjectKey(destAbs) };
}

/** Best-effort local + R2 delete. */
export async function deleteLocalUpload(absOrKey) {
  const key = toUploadObjectKey(absOrKey);
  let abs = '';
  try {
    abs = key ? absoluteUploadPath(key) : String(absOrKey || '');
  } catch {
    abs = String(absOrKey || '');
  }
  if (abs && fs.existsSync(abs)) {
    try {
      fs.unlinkSync(abs);
    } catch {
      /* ignore */
    }
  }
  if (key && isObjectStoreEnabled()) {
    await deleteObject(key).catch(() => {});
  }
}
