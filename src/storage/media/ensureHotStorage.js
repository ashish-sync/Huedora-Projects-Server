import {
  isObjectStoreEnabled,
  copyObjectStorageClass,
  headObject,
  R2_STORAGE_STANDARD,
  R2_STORAGE_IA,
} from '../objectStore.js';
import { toUploadObjectKey, absoluteUploadPath } from '../uploadKeys.js';
import { getStoredFileByKey } from './touchAccess.js';
import fs from 'fs';

/**
 * If object is on Infrequent Access, CopyObject back to STANDARD before serving.
 * Verifies Head, then updates registry. Same object key — no permanent second copy.
 */
export async function ensureHotStorage(absOrKey) {
  const objectKey = toUploadObjectKey(absOrKey);
  if (!objectKey) return { restored: false };

  const row = await getStoredFileByKey(objectKey);
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
    if (row) {
      row.status = 'ready';
      row.storageClass = R2_STORAGE_STANDARD;
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

  if (row) {
    row.status = 'ready';
    row.storageClass = R2_STORAGE_STANDARD;
    row.lastAccessedAt = new Date().toISOString();
    await row.save();
  }

  console.log(`[media] restored to STANDARD key=${objectKey}`);
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
