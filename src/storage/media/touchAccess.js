import { StoredFile } from '../../modules/files/storedFile.model.js';
import { toUploadObjectKey } from '../uploadKeys.js';

/**
 * Bump lastAccessedAt for a stored object. Does not touch entity retention fields.
 */
export async function touchStoredFileAccess(absOrKey) {
  const objectKey = toUploadObjectKey(absOrKey);
  if (!objectKey) return null;
  try {
    const row = await StoredFile.findOne({ objectKey, isDeleted: false });
    if (!row) return null;
    row.lastAccessedAt = new Date().toISOString();
    await row.save();
    return row;
  } catch (err) {
    console.warn(`[media] touch access failed key=${objectKey}: ${err?.message || err}`);
    return null;
  }
}

export async function getStoredFileByKey(absOrKey) {
  const objectKey = toUploadObjectKey(absOrKey);
  if (!objectKey) return null;
  return StoredFile.findOne({ objectKey, isDeleted: false });
}
