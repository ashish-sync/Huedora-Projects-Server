import fs from 'fs';
import path from 'path';
import { collectUploadedFiles } from '../utils/rejectUnsafeUpload.js';
import {
  optimizeExecutionDocumentFile,
  logExecutionDocFootprint,
} from './media/optimizeExecutionDoc.js';
import { optimizeGpsSelfieFile } from './media/optimizeGpsSelfie.js';
import { processUploadedMedia, applyProcessResultToMulterInfo } from './media/processUpload.js';
import { toUploadObjectKey, absoluteUploadPath, publicUploadPath } from './uploadKeys.js';
import { isObjectStoreEnabled, R2_STORAGE_STANDARD } from './objectStore.js';
import { sha256File } from './media/contentHash.js';
import { StoredFile } from '../modules/files/storedFile.model.js';
import { assignPreservingExisting } from '../store/dataIntegrity.js';

function masterKeyWithExt(objectKey, newExt) {
  const key = String(objectKey || '').replace(/\\/g, '/');
  const dir = path.posix.dirname(key);
  const base = path.posix.basename(key);
  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  const next = `${stem}${newExt}`;
  return dir && dir !== '.' ? `${dir}/${next}` : next;
}

async function upsertRegistry(patch) {
  const key = String(patch.objectKey || '').trim();
  if (!key) throw new Error('objectKey required');
  let row = await StoredFile.findOne({ objectKey: key, isDeleted: false });
  if (!row) {
    return StoredFile.create({
      objectKey: key,
      ...patch,
      lastAccessedAt: patch.lastAccessedAt || new Date().toISOString(),
    });
  }
  assignPreservingExisting(row, patch, { clearKeys: ['lastError'] });
  await row.save();
  return row;
}

async function writeOptimizedUpload(file, optimized, sourceKey) {
  logExecutionDocFootprint(file.originalname || sourceKey, optimized);

  const nextKey = masterKeyWithExt(sourceKey, optimized.ext);
  const nextAbs = absoluteUploadPath(nextKey);
  fs.mkdirSync(path.dirname(nextAbs), { recursive: true });
  fs.writeFileSync(nextAbs, optimized.buffer);

  if (!fs.existsSync(nextAbs) || fs.statSync(nextAbs).size !== optimized.buffer.length) {
    throw new Error('Execution document optimize write failed verification');
  }

  // Local commit only — R2 is enqueued after semantic rename so the registry key
  // matches the final stored name (never leave a false-ready temp key on R2).
  if (nextAbs !== file.path) {
    try {
      fs.unlinkSync(file.path);
    } catch {
      /* ignore */
    }
  }

  const contentHash = await sha256File(nextAbs);
  await upsertRegistry({
    objectKey: nextKey,
    contentHash,
    kind: optimized.kind || 'other',
    contentType: optimized.contentType,
    sizeBytes: optimized.buffer.length,
    originalName: file.originalname,
    status: isObjectStoreEnabled() ? 'pending' : 'ready',
    storageClass: R2_STORAGE_STANDARD,
    refCount: 1,
    processedAt: new Date().toISOString(),
    processAttempts: 1,
    lastError: '',
    reductionRatio: optimized.reductionRatio,
    lastAccessedAt: new Date().toISOString(),
  });

  file.path = nextAbs;
  file.filename = path.basename(nextAbs);
  file.size = optimized.buffer.length;
  file.mimetype = optimized.contentType;
  file.objectKey = nextKey;
  file.mediaFinalized = true;
  file.publicPath = publicUploadPath(nextKey);
}

/**
 * Camp One execution-document finalize → R2.
 * DF/PF/Other: 8-bit L grayscale WebP/PDF.
 * GPS Selfie: indexed-color WebP (8–16 palette).
 */
export async function finalizeExecutionDocumentUploads(req, { docType = '' } = {}) {
  const files = collectUploadedFiles(req);
  const isGpsSelfie = String(docType) === 'gps_selfie';

  for (const file of files) {
    if (!file?.path || file.mediaFinalized) continue;
    if (!fs.existsSync(file.path)) continue;

    const sourceKey = toUploadObjectKey(file.path);

    if (isGpsSelfie) {
      try {
        const optimized = await optimizeGpsSelfieFile(file.path);
        if (optimized?.buffer?.length) {
          await writeOptimizedUpload(file, optimized, sourceKey);
          continue;
        }
      } catch (err) {
        console.warn(
          `[media:gps-selfie] indexed WebP failed (${err?.message || err}); falling back to generic photo pipeline`,
        );
      }
      const result = await processUploadedMedia(file.path, {
        originalName: file.originalname,
        mimetype: file.mimetype,
        deferR2: true,
      });
      applyProcessResultToMulterInfo(file, result);
      file.mediaFinalized = true;
      continue;
    }

    const optimized = await optimizeExecutionDocumentFile(file.path, {
      originalName: file.originalname,
      mimetype: file.mimetype,
    });

    if (!optimized?.buffer?.length) {
      const result = await processUploadedMedia(file.path, {
        originalName: file.originalname,
        mimetype: file.mimetype,
        deferR2: true,
      });
      applyProcessResultToMulterInfo(file, result);
      file.mediaFinalized = true;
      continue;
    }

    await writeOptimizedUpload(file, optimized, sourceKey);
  }

  return files;
}
