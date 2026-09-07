import fs from 'fs';
import path from 'path';
import { StoredFile } from '../../modules/files/storedFile.model.js';
import { assignPreservingExisting } from '../../store/dataIntegrity.js';
import { isObjectStoreEnabled, putLocalFile, deleteObject, R2_STORAGE_STANDARD } from '../objectStore.js';
import { toUploadObjectKey, absoluteUploadPath, publicUploadPath } from '../uploadKeys.js';
import { classifyUploadKind } from './mediaKinds.js';
import { optimizeImageToWebp } from './optimizeImage.js';
import { optimizeWebpResizeOnly } from './optimizeGpsSelfie.js';
import { optimizePdfBuffer } from './optimizePdf.js';
import { sha256Buffer, sha256File } from './contentHash.js';
import { warnIfHighMemory } from '../../utils/memory.js';

const RSS_SKIP_OPTIMIZE_MB = 380;

function masterKeyWithExt(objectKey, newExt) {
  const key = String(objectKey || '').replace(/\\/g, '/');
  const dir = path.posix.dirname(key);
  const base = path.posix.basename(key);
  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  const next = `${stem}${newExt}`;
  return dir && dir !== '.' ? `${dir}/${next}` : next;
}

async function findByContentHash(contentHash) {
  if (!contentHash) return null;
  const rows = await StoredFile.find({ contentHash, isDeleted: false });
  const list = Array.isArray(rows) ? rows : [];
  return (
    list.find(
      (r) =>
        ['ready', 'archived'].includes(String(r.status)) &&
        Number(r.refCount) > 0 &&
        r.objectKey,
    ) || null
  );
}

async function upsertRegistry(patch) {
  const key = String(patch.objectKey || '').trim();
  if (!key) throw new Error('objectKey required');
  let row = await StoredFile.findOne({ objectKey: key, isDeleted: false });
  if (!row) {
    row = await StoredFile.create({
      objectKey: key,
      ...patch,
      lastAccessedAt: patch.lastAccessedAt || new Date().toISOString(),
    });
    return row;
  }
  assignPreservingExisting(row, patch, { clearKeys: ['lastError'] });
  await row.save();
  return row;
}

/**
 * Optimize (image/pdf), dedupe, write one master, persist R2, register.
 * Safe order: write+verify new → update registry → delete old bytes.
 *
 * @param {string} absPath
 * @param {{ originalName?: string, mimetype?: string, skipOptimize?: boolean }} [opts]
 */
export async function processUploadedMedia(absPath, opts = {}) {
  const originalName = opts.originalName || path.basename(absPath);
  const mimetype = opts.mimetype || '';
  const kind = classifyUploadKind({ originalName, mimetype });
  const sourceKey = toUploadObjectKey(absPath);
  if (!sourceKey) throw new Error(`Cannot map path to object key: ${absPath}`);
  if (!fs.existsSync(absPath)) throw new Error(`Upload missing: ${absPath}`);

  const mem = warnIfHighMemory('media:process', { rssWarnMb: RSS_SKIP_OPTIMIZE_MB });
  const skipOptimize =
    opts.skipOptimize === true || (mem?.rssMb != null && mem.rssMb >= RSS_SKIP_OPTIMIZE_MB);

  let workingAbs = absPath;
  let contentType = mimetype || 'application/octet-stream';
  let reductionRatio = null;
  /** @type {string|null} */
  let obsoleteKey = null;

  if (!skipOptimize && kind === 'image') {
    const before = fs.statSync(absPath).size;
    let result;
    try {
      result = await optimizeImageToWebp(absPath);
    } catch (err) {
      console.warn(
        `[media] standard image optimize failed (${err?.message || err}); trying resize-only WebP`,
      );
      result = await optimizeWebpResizeOnly(absPath);
    }
    const after = result.buffer.length;
    if (after > 0) {
      reductionRatio = before > 0 ? after / before : null;
      const nextKey = masterKeyWithExt(sourceKey, '.webp');
      const nextAbs = absoluteUploadPath(nextKey);
      fs.mkdirSync(path.dirname(nextAbs), { recursive: true });
      fs.writeFileSync(nextAbs, result.buffer);
      if (!fs.existsSync(nextAbs) || fs.statSync(nextAbs).size !== after) {
        throw new Error('Optimized image master missing after write');
      }
      if (nextAbs !== absPath) {
        obsoleteKey = sourceKey;
        try {
          fs.unlinkSync(absPath);
        } catch {
          /* ignore */
        }
      }
      workingAbs = nextAbs;
      contentType = result.contentType || 'image/webp';
    } else {
      contentType = mimetype || contentType;
    }
  } else if (!skipOptimize && kind === 'pdf') {
    const input = fs.readFileSync(absPath);
    const result = await optimizePdfBuffer(input);
    if (result.optimized && result.buffer.length < input.length) {
      reductionRatio = result.buffer.length / input.length;
      fs.writeFileSync(absPath, result.buffer);
      contentType = 'application/pdf';
    } else {
      contentType = 'application/pdf';
    }
    workingAbs = absPath;
  } else if (kind === 'pdf') {
    contentType = 'application/pdf';
  }

  const objectKey = toUploadObjectKey(workingAbs);
  if (!objectKey) throw new Error('Invalid master object key after process');

  const sizeBytes = fs.statSync(workingAbs).size;
  const contentHash = await sha256File(workingAbs);

  const existing = await findByContentHash(contentHash);
  if (existing && existing.objectKey && existing.objectKey !== objectKey) {
    existing.refCount = Math.max(1, Number(existing.refCount) || 1) + 1;
    existing.lastAccessedAt = new Date().toISOString();
    await existing.save();

    try {
      if (fs.existsSync(workingAbs)) fs.unlinkSync(workingAbs);
    } catch {
      /* ignore */
    }
    if (isObjectStoreEnabled()) {
      await deleteObject(objectKey).catch(() => {});
      if (obsoleteKey && obsoleteKey !== existing.objectKey) {
        await deleteObject(obsoleteKey).catch(() => {});
      }
    }

    const sharedAbs = absoluteUploadPath(existing.objectKey);
    return {
      absPath: fs.existsSync(sharedAbs) ? sharedAbs : workingAbs,
      objectKey: existing.objectKey,
      publicPath: publicUploadPath(existing.objectKey),
      contentType: existing.contentType || contentType,
      sizeBytes: Number(existing.sizeBytes) || sizeBytes,
      originalName,
      kind,
      contentHash,
      deduped: true,
      reductionRatio: existing.reductionRatio ?? reductionRatio,
      row: existing,
    };
  }

  if (isObjectStoreEnabled()) {
    if (opts.skipR2) {
      // Local optimize only — caller will rename then put/enqueue under the final key.
      await upsertRegistry({
        objectKey,
        contentHash,
        kind,
        contentType,
        sizeBytes,
        originalName,
        status: 'pending',
        storageClass: R2_STORAGE_STANDARD,
        refCount: 1,
        processedAt: new Date().toISOString(),
        processAttempts: 1,
        lastError: '',
        reductionRatio,
        lastAccessedAt: new Date().toISOString(),
      });
    } else if (opts.deferR2) {
      // Register pending first so a crash before/during R2 cannot look like success.
      await upsertRegistry({
        objectKey,
        contentHash,
        kind,
        contentType,
        sizeBytes,
        originalName,
        status: 'pending',
        storageClass: R2_STORAGE_STANDARD,
        refCount: 1,
        processedAt: new Date().toISOString(),
        processAttempts: 1,
        lastError: '',
        reductionRatio,
        lastAccessedAt: new Date().toISOString(),
      });
      const { enqueueR2Put } = await import('./mediaQueue.js');
      await enqueueR2Put({
        absPath: workingAbs,
        objectKey,
        contentType,
        originalName,
      });
    } else {
      await putLocalFile(workingAbs, objectKey, {
        contentType,
        storageClass: R2_STORAGE_STANDARD,
      });
      await upsertRegistry({
        objectKey,
        contentHash,
        kind,
        contentType,
        sizeBytes,
        originalName,
        status: 'ready',
        storageClass: R2_STORAGE_STANDARD,
        refCount: 1,
        processedAt: new Date().toISOString(),
        processAttempts: 1,
        lastError: '',
        reductionRatio,
        lastAccessedAt: new Date().toISOString(),
      });
    }
  } else {
    await upsertRegistry({
      objectKey,
      contentHash,
      kind,
      contentType,
      sizeBytes,
      originalName,
      status: 'ready',
      storageClass: R2_STORAGE_STANDARD,
      refCount: 1,
      processedAt: new Date().toISOString(),
      processAttempts: 1,
      lastError: '',
      reductionRatio,
      lastAccessedAt: new Date().toISOString(),
    });
  }

  const row = await StoredFile.findOne({
    objectKey,
    isDeleted: false,
  });

  if (isObjectStoreEnabled() && obsoleteKey && obsoleteKey !== objectKey) {
    if (opts.deferR2) {
      // Best-effort async delete of obsolete key after new master is queued
      const { deleteObject } = await import('../objectStore.js');
      deleteObject(obsoleteKey).catch(() => {});
    } else {
      await deleteObject(obsoleteKey).catch(() => {});
    }
  }

  return {
    absPath: workingAbs,
    objectKey,
    publicPath: publicUploadPath(objectKey),
    contentType,
    sizeBytes,
    originalName,
    kind,
    contentHash,
    deduped: false,
    reductionRatio,
    row,
  };
}

/**
 * Apply process result onto a multer file info object.
 */
export function applyProcessResultToMulterInfo(info, result) {
  if (!info || !result) return info;
  info.path = result.absPath;
  info.filename = path.basename(result.absPath);
  info.size = result.sizeBytes;
  info.mimetype = result.contentType || info.mimetype;
  info.objectKey = result.objectKey;
  info.deduped = result.deduped;
  info.mediaKind = result.kind;
  return info;
}

export { sha256Buffer };
