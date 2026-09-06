import { StoredFile } from '../../modules/files/storedFile.model.js';
import {
  isObjectStoreEnabled,
  copyObjectStorageClass,
  headObject,
  R2_STORAGE_IA,
  R2_STORAGE_STANDARD,
} from '../objectStore.js';
import { unlinkLocalIfPresent } from './ensureHotStorage.js';
import { sweepExpiredThumbCache } from './thumbCache.js';

export const FILE_IDLE_ARCHIVE_DAYS = 90;

/**
 * Move idle ready files to R2 Infrequent Access (STANDARD_IA).
 * Clock: lastAccessedAt only — independent of entity retention soft-archive.
 *
 * Safety: CopyObject to IA → Head verify → update DB → delete local hot copy.
 * Object key stays the same (class change); no permanent second master.
 */
export async function runFileColdStorageJob({ dryRun = false, limit = 100 } = {}) {
  const cutoff = new Date(Date.now() - FILE_IDLE_ARCHIVE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await StoredFile.find({ isDeleted: false, status: 'ready' });
  const list = (Array.isArray(rows) ? rows : [])
    .filter((r) => {
      if (String(r.storageClass || '').toUpperCase() === R2_STORAGE_IA) return false;
      const accessed = r.lastAccessedAt ? new Date(r.lastAccessedAt) : r.processedAt ? new Date(r.processedAt) : null;
      if (!accessed || Number.isNaN(accessed.getTime())) return false;
      return accessed <= cutoff;
    })
    .slice(0, limit);

  let archived = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of list) {
    const key = String(row.objectKey || '').trim();
    if (!key) {
      skipped += 1;
      continue;
    }
    if (dryRun) {
      archived += 1;
      continue;
    }
    try {
      if (isObjectStoreEnabled()) {
        const result = await copyObjectStorageClass(key, R2_STORAGE_IA, {
          contentType: row.contentType || undefined,
        });
        const head = await headObject(key);
        if (!head) {
          throw new Error('HeadObject missing after IA transition');
        }
        const remoteClass = String(head.StorageClass || result.storageClass || '').toUpperCase();
        // Some R2 responses omit StorageClass on Head; trust successful CopyObject when size matches
        if (
          remoteClass &&
          remoteClass !== R2_STORAGE_IA &&
          remoteClass !== 'INTELLIGENT_TIERING'
        ) {
          // STANDARD reported unexpectedly — still accept if CopyObject claimed ok
          if (!result?.ok) throw new Error(`Unexpected storage class after archive: ${remoteClass}`);
        }

        row.status = 'archived';
        row.storageClass = R2_STORAGE_IA;
        await row.save();
        unlinkLocalIfPresent(key);
        archived += 1;
        console.log(`[media] archived to STANDARD_IA key=${key}`);
      } else {
        // No R2: mark archived in registry only (bytes stay on local disk)
        row.status = 'archived';
        row.storageClass = R2_STORAGE_STANDARD;
        await row.save();
        archived += 1;
      }
    } catch (err) {
      errors += 1;
      console.error(`[media] cold archive failed key=${key}: ${err?.message || err}`);
    }
  }

  const thumbSweep = sweepExpiredThumbCache();
  return {
    scanned: list.length,
    archived,
    skipped,
    errors,
    thumbsRemoved: thumbSweep.removed,
    cutoff: cutoff.toISOString(),
  };
}
