import fs from 'fs';
import path from 'path';
import { collectUploadedFiles } from '../utils/rejectUnsafeUpload.js';
import {
  optimizeExecutionDocumentFile,
  logExecutionDocFootprint,
} from './media/optimizeExecutionDoc.js';
import {
  optimizeGpsSelfieFile,
  optimizeWebpResizeOnly,
  isWebpFileByMagic,
} from './media/optimizeGpsSelfie.js';
import { processUploadedMedia, applyProcessResultToMulterInfo } from './media/processUpload.js';
import { toUploadObjectKey, absoluteUploadPath, publicUploadPath } from './uploadKeys.js';
import { isObjectStoreEnabled, R2_STORAGE_STANDARD } from './objectStore.js';
import { sha256File } from './media/contentHash.js';
import { StoredFile } from '../modules/files/storedFile.model.js';
import { assignPreservingExisting } from '../store/dataIntegrity.js';
import { warnIfHighMemory, logMemory, relieveMemoryPressure, RSS_DROP_CACHE_MB, RSS_REFUSE_IMAGE_MB } from '../utils/memory.js';
import { withImageProcessGate } from './media/imageProcessGate.js';
import {
  assertUploadByteLimit,
  assertPixelBudget,
  EXEC_DOC_MAX_BYTES,
  EXEC_DOC_MAX_FILES_PER_REQUEST,
  SHARP_LIMIT_INPUT_PIXELS,
} from './media/uploadLimits.js';
import { AppError } from '../utils/helpers.js';
import sharp from 'sharp';

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

function optimizedByteLength(optimized) {
  if (optimized?.filePath && fs.existsSync(optimized.filePath)) {
    return fs.statSync(optimized.filePath).size;
  }
  if (Buffer.isBuffer(optimized?.buffer)) return optimized.buffer.length;
  return 0;
}

async function writeOptimizedUpload(file, optimized, sourceKey) {
  logExecutionDocFootprint(file.originalname || sourceKey, {
    ...optimized,
    buffer: optimized.buffer || Buffer.alloc(0),
    bytesPerPage: optimizedByteLength(optimized),
  });

  const nextKey = masterKeyWithExt(sourceKey, optimized.ext);
  const nextAbs = absoluteUploadPath(nextKey);
  fs.mkdirSync(path.dirname(nextAbs), { recursive: true });

  if (optimized.filePath && fs.existsSync(optimized.filePath)) {
    if (path.resolve(optimized.filePath) !== path.resolve(nextAbs)) {
      fs.copyFileSync(optimized.filePath, nextAbs);
      try {
        fs.unlinkSync(optimized.filePath);
      } catch {
        /* ignore */
      }
    }
  } else if (Buffer.isBuffer(optimized.buffer) && optimized.buffer.length) {
    fs.writeFileSync(nextAbs, optimized.buffer);
  } else {
    throw new AppError('Optimized upload produced no bytes', 500, 'UPLOAD_OPTIMIZE_FAILED');
  }

  const sizeBytes = fs.statSync(nextAbs).size;
  if (!sizeBytes) {
    throw new AppError('Execution document optimize write failed verification', 500, 'UPLOAD_OPTIMIZE_FAILED');
  }

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
    sizeBytes,
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
  file.size = sizeBytes;
  file.mimetype = optimized.contentType;
  file.objectKey = nextKey;
  file.mediaFinalized = true;
  file.publicPath = publicUploadPath(nextKey);
}

async function assertSafeImagePixels(absPath) {
  const meta = await sharp(absPath, {
    failOn: 'none',
    animated: false,
    limitInputPixels: SHARP_LIMIT_INPUT_PIXELS,
  }).metadata();
  assertPixelBudget(meta.width, meta.height);
  return meta;
}

function mapOptimizeError(err) {
  if (err instanceof AppError) return err;
  const code = err?.code || 'UPLOAD_OPTIMIZE_FAILED';
  const status = err?.status || (code === 'UPLOAD_TOO_MANY_PIXELS' || code === 'UPLOAD_TOO_LARGE' ? 413 : 500);
  return new AppError(
    err?.message || 'Image processing failed. Try a smaller image.',
    status,
    code,
  );
}

/**
 * Camp One execution-document finalize (local optimize only; R2 after rename).
 * DF/PF/Other: 8-bit L grayscale WebP/PDF.
 * GPS Selfie: indexed-color WebP (8–16 palette) or passthrough.
 */
export async function finalizeExecutionDocumentUploads(req, { docType = '' } = {}) {
  const files = collectUploadedFiles(req);
  if (files.length > EXEC_DOC_MAX_FILES_PER_REQUEST) {
    throw new AppError(
      `Upload at most ${EXEC_DOC_MAX_FILES_PER_REQUEST} files at a time.`,
      400,
      'UPLOAD_TOO_MANY_FILES',
    );
  }
  const isGpsSelfie = String(docType) === 'gps_selfie';
  logMemory('finalize:exec-docs:start', { docType, fileCount: files.length });

  const startMem = warnIfHighMemory('finalize:exec-docs', { rssWarnMb: 350 });
  let rssMb = startMem?.rssMb;
  if (rssMb >= RSS_DROP_CACHE_MB) {
    const after = await relieveMemoryPressure('finalize:exec-docs');
    rssMb = after?.rssMb ?? rssMb;
  }
  const memoryPressure = rssMb != null && rssMb >= 350;
  const refuseSharp = rssMb != null && rssMb >= RSS_REFUSE_IMAGE_MB;

  for (const file of files) {
    if (!file?.path || file.mediaFinalized) continue;
    if (!fs.existsSync(file.path)) continue;

    assertUploadByteLimit(file.size || fs.statSync(file.path).size, EXEC_DOC_MAX_BYTES);
    const sourceKey = toUploadObjectKey(file.path);

    // High RSS: GPS WebP = byte-copy only (no Sharp / no gate). This is what OOM'd at ~540MB before.
    if (isGpsSelfie && memoryPressure && isWebpFileByMagic(file.path)) {
      logMemory('finalize:gps-webp-passthrough', { rssMb });
      const optimized = await optimizeGpsSelfieFile(file.path, { lightOnly: true });
      if (optimizedByteLength(optimized) > 0) {
        await writeOptimizedUpload(file, optimized, sourceKey);
        continue;
      }
    }

    if (refuseSharp) {
      throw new AppError(
        `Server memory is too high (${rssMb} MB) for image processing. Upload a WebP GPS selfie or try again shortly.`,
        503,
        'UPLOAD_MEMORY_PRESSURE',
      );
    }

    await withImageProcessGate(`finalize:${docType}`, async () => {
      const lightOnly = isGpsSelfie && memoryPressure;

      // Sharp metadata itself can OOM when RSS is already high — skip under lightOnly.
      if (!lightOnly && (isGpsSelfie || String(file.mimetype || '').startsWith('image/'))) {
        await assertSafeImagePixels(file.path);
      }

      if (isGpsSelfie) {
        try {
          const optimized = await optimizeGpsSelfieFile(file.path, { lightOnly });
          if (optimizedByteLength(optimized) > 0) {
            await writeOptimizedUpload(file, optimized, sourceKey);
            return;
          }
        } catch (err) {
          if (err?.code === 'UPLOAD_MEMORY_PRESSURE' || err?.status === 503) {
            throw mapOptimizeError(err);
          }
          console.warn(
            `[media:gps-selfie] indexed WebP failed (${err?.message || err}); falling back to resize-only WebP`,
          );
        }
        if (lightOnly) {
          throw new AppError(
            'Server memory is too high to process this GPS selfie. Upload a WebP or try again shortly.',
            503,
            'UPLOAD_MEMORY_PRESSURE',
          );
        }
        try {
          const light = await optimizeWebpResizeOnly(file.path);
          if (optimizedByteLength(light) > 0) {
            await writeOptimizedUpload(
              file,
              { ...light, kind: 'image', reductionRatio: null },
              sourceKey,
            );
            return;
          }
        } catch (fallbackErr) {
          console.warn(
            `[media:gps-selfie] resize-only fallback failed (${fallbackErr?.message || fallbackErr})`,
          );
          throw mapOptimizeError(fallbackErr);
        }
        throw new AppError('GPS Selfie optimize failed', 500, 'UPLOAD_OPTIMIZE_FAILED');
      }

      const optimized = await optimizeExecutionDocumentFile(file.path, {
        originalName: file.originalname,
        mimetype: file.mimetype,
      });

      if (!optimizedByteLength(optimized)) {
        const result = await processUploadedMedia(file.path, {
          originalName: file.originalname,
          mimetype: file.mimetype,
          skipR2: true,
        });
        applyProcessResultToMulterInfo(file, result);
        file.mediaFinalized = true;
        return;
      }

      await writeOptimizedUpload(file, optimized, sourceKey);
    }, { originalName: file.originalname, size: file.size });
  }

  logMemory('finalize:exec-docs:done', { docType, fileCount: files.length });
  return files;
}
