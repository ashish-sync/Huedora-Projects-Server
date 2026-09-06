import {
  isObjectStoreEnabled,
  copyObjectStorageClass,
  headObject,
  R2_STORAGE_STANDARD,
  R2_STORAGE_IA,
} from '../objectStore.js';
import { toUploadObjectKey, absoluteUploadPath } from '../uploadKeys.js';
import { getStoredFileByKey } from './touchAccess.js';
import { StoredFile } from '../../modules/files/storedFile.model.js';
import fs from 'fs';

/**
 * Mark registry row as hot Standard and reset the 90-day idle clock.
 * Critical: lastAccessedAt = NOW so cold job cannot immediately re-archive.
 */
export function applyHotAccessFields(row, { now = new Date() } = {}) {
  if (!row) return null;
  const iso = (now instanceof Date ? now : new Date(now)).toISOString();
  row.status = 'ready';
  row.storageClass = R2_STORAGE_STANDARD;
  row.lastAccessedAt = iso;
  return row;
}

/**
 * If object is on Infrequent Access, CopyObject back to STANDARD before serving.
 * Always resets lastAccessedAt on restore so the 90-day clock restarts.
 */
export async function ensureHotStorage(absOrKey, { now = new Date() } = {}) {
  const objectKey = toUploadObjectKey(absOrKey);
  if (!objectKey) return { restored: false };

  let row = await getStoredFileByKey(objectKey);
  const classFromDb = String(row?.storageClass || '').toUpperCase();
  let needsRestore =
    classFromDb === R2_STORAGE_IA || String(row?.status) === 'archived';

  if (!needsRestore && isObjectStoreEnabled()) {
    const head = await headObject(objectKey);
    const remoteClass = String(head?.StorageClass || '').toUpperCase();
    if (remoteClass === R2_STORAGE_IA) needsRestore = true;
  }

  if (!needsRestore) {
    return { restored: false, objectKey, row };
  }

  if (!isObjectStoreEnabled()) {
    if (!row) {
      row = await StoredFile.create({
        objectKey,
        status: 'ready',
        storageClass: R2_STORAGE_STANDARD,
        lastAccessedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
      });
    } else {
      applyHotAccessFields(row, { now });
      await row.save();
    }
    return { restored: true, objectKey, row, localOnly: true };
  }

  const result = await copyObjectStorageClass(objectKey, R2_STORAGE_STANDARD, {
    contentType: row?.contentType || undefined,
  });
  if (!result?.ok && !result?.skipped) {
    throw new Error(`Failed to restore object from Infrequent Access: ${objectKey}`);
  }

  if (!row) {
    row = await StoredFile.create({
      objectKey,
      status: 'ready',
      storageClass: R2_STORAGE_STANDARD,
      lastAccessedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    });
  } else {
    applyHotAccessFields(row, { now });
    await row.save();
  }

  console.log(`[media] restored to STANDARD key=${objectKey} lastAccessedAt=${row.lastAccessedAt}`);
  return { restored: true, objectKey, row, result };
}

/** Best-effort delete local disk copy after successful IA archive (Render disk is ephemeral). */
export function unlinkLocalIfPresent(objectKey) {
  try {
    const abs = absoluteUploadPath(objectKey);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    /* ignore */
  }
}
