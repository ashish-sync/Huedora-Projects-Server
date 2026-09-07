/**
 * Browser → Cloudflare R2 direct upload for Camp One execution documents.
 * Server never proxies the full original bytes when R2 is enabled.
 */
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import {
  createPresignedPutUrl,
  headObject,
  getObjectToFile,
  isObjectStoreEnabled,
  deleteObject,
} from './objectStore.js';
import { absoluteUploadPath, publicUploadPath } from './uploadKeys.js';
import { buildExecutionDocumentFileName } from '../../modules/campOps/executionDocumentName.js';
import {
  assertUploadByteLimit,
  EXEC_DOC_MAX_BYTES,
  EXEC_DOC_MAX_FILES_PER_REQUEST,
} from './media/uploadLimits.js';
import { logMemory } from '../../utils/memory.js';
import { AppError } from '../../utils/helpers.js';
import { finalizeExecutionDocumentUploads } from './finalizeExecutionDocs.js';
import { renameLocalUpload } from './persistUpload.js';
import { assertSafeUpload } from '../../utils/uploadSafety.js';

const TEMP_PREFIX = 'camp-ops/_direct/';

function safeOriginalExt(name = '') {
  const ext = path.extname(String(name || '')).toLowerCase();
  return ext && ext !== '.' ? ext : '';
}

/**
 * Mint one or more presigned PUT URLs for direct R2 upload.
 */
export async function presignExecutionDocumentUploads({
  camp,
  docType,
  files = [],
} = {}) {
  if (!isObjectStoreEnabled()) {
    return { mode: 'proxy', reason: 'R2_DISABLED' };
  }
  if (!Array.isArray(files) || !files.length) {
    throw new AppError('Select at least one file', 400, 'VALIDATION_ERROR');
  }
  if (files.length > EXEC_DOC_MAX_FILES_PER_REQUEST) {
    throw new AppError(
      `Upload at most ${EXEC_DOC_MAX_FILES_PER_REQUEST} files at a time.`,
      400,
      'UPLOAD_TOO_MANY_FILES',
    );
  }

  const items = [];
  for (const file of files) {
    const originalName = String(file?.name || file?.originalName || 'upload.bin');
    const contentType = String(file?.contentType || file?.type || 'application/octet-stream');
    const size = Number(file?.size) || 0;
    assertUploadByteLimit(size, EXEC_DOC_MAX_BYTES);

    if (docType === 'gps_selfie' && !contentType.startsWith('image/')) {
      throw new AppError('GPS Selfie must be an image file', 400, 'VALIDATION_ERROR');
    }

    const check = assertSafeUpload(
      { originalname: originalName, mimetype: contentType, size },
      {
        allowedExt: ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'],
      },
    );
    if (!check.ok) {
      throw new AppError(check.message, 400, 'UPLOAD_REJECTED');
    }

    const uploadId = randomUUID().replace(/-/g, '').slice(0, 16);
    const ext = safeOriginalExt(originalName) || '.bin';
    const objectKey = `${TEMP_PREFIX}${camp.campId || camp._id}/${uploadId}${ext}`;
    const signed = await createPresignedPutUrl(objectKey, {
      contentType,
      expiresIn: 600,
    });
    items.push({
      uploadId,
      objectKey: signed.objectKey,
      uploadUrl: signed.uploadUrl,
      headers: signed.headers,
      expiresIn: signed.expiresIn,
      originalName,
      contentType,
      size,
    });
  }

  logMemory('presign:exec-docs', { count: items.length, docType });
  return { mode: 'direct', items };
}

/**
 * After browser PUT to R2: stream object to disk, optimize under gate, confirm R2, attach to camp.
 * Returns the same shape as the multipart upload handler's added docs + enriched camp fields.
 */
export async function confirmExecutionDocumentUploads({
  camp,
  docType,
  docNote = '',
  items = [],
  reqStub = null,
} = {}) {
  if (!isObjectStoreEnabled()) {
    throw new AppError('Direct cloud upload is not configured', 503, 'DIRECT_UPLOAD_UNAVAILABLE');
  }
  if (!Array.isArray(items) || !items.length) {
    throw new AppError('No uploaded items to confirm', 400, 'VALIDATION_ERROR');
  }
  if (items.length > EXEC_DOC_MAX_FILES_PER_REQUEST) {
    throw new AppError(
      `Upload at most ${EXEC_DOC_MAX_FILES_PER_REQUEST} files at a time.`,
      400,
      'UPLOAD_TOO_MANY_FILES',
    );
  }

  const multerLikeFiles = [];
  const tempKeys = [];

  try {
    for (const item of items) {
      const objectKey = String(item.objectKey || '').replace(/^\/+/, '');
      if (!objectKey.startsWith(TEMP_PREFIX)) {
        throw new AppError('Invalid upload object key', 400, 'UPLOAD_REJECTED');
      }
      const originalName = String(item.originalName || path.basename(objectKey));
      const contentType = String(item.contentType || 'application/octet-stream');
      const expectedSize = Number(item.size) || 0;

      logMemory('confirm:head', { objectKey });
      const head = await headObject(objectKey);
      if (!head) {
        throw new AppError(
          `Upload “${originalName}” was not found in cloud storage. Retry the upload.`,
          400,
          'UPLOAD_MISSING_IN_R2',
        );
      }
      const remoteSize = Number(head.ContentLength) || 0;
      if (expectedSize && remoteSize && Math.abs(remoteSize - expectedSize) > 64) {
        throw new AppError(
          `Upload size mismatch for “${originalName}”. Retry the upload.`,
          400,
          'UPLOAD_SIZE_MISMATCH',
        );
      }
      assertUploadByteLimit(remoteSize || expectedSize, EXEC_DOC_MAX_BYTES);

      const localAbs = absoluteUploadPath(objectKey);
      logMemory('confirm:get-to-disk', { objectKey, remoteSize });
      await getObjectToFile(objectKey, localAbs);
      tempKeys.push(objectKey);

      // Peek magic without loading whole file
      const magic = Buffer.alloc(16);
      const fd = fs.openSync(localAbs, 'r');
      try {
        fs.readSync(fd, magic, 0, 16, 0);
      } finally {
        fs.closeSync(fd);
      }
      const check = assertSafeUpload(
        {
          originalname: originalName,
          mimetype: contentType,
          size: remoteSize || expectedSize,
          buffer: magic,
        },
        { allowedExt: ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'] },
      );
      if (!check.ok) {
        throw new AppError(check.message, 400, 'UPLOAD_REJECTED');
      }

      multerLikeFiles.push({
        path: localAbs,
        filename: path.basename(localAbs),
        originalname: originalName,
        mimetype: contentType,
        size: remoteSize || expectedSize,
        mediaFinalized: false,
      });
    }

    const fakeReq = reqStub || { files: multerLikeFiles, file: undefined };
    fakeReq.files = multerLikeFiles;
    await finalizeExecutionDocumentUploads(fakeReq, { docType });

    const existing = Array.isArray(camp.executionDocuments) ? camp.executionDocuments : [];
    const uploadedAt = new Date().toISOString();
    const usedNames = existing.flatMap((doc) => [doc.fileName, doc.storedName]).filter(Boolean);
    const added = [];

    for (const [index, file] of multerLikeFiles.entries()) {
      const { fileName: displayName, storedName } = buildExecutionDocumentFileName({
        doctorName: camp.doctorName,
        docType,
        originalName: file.filename || file.originalname,
        existingNames: usedNames,
        index,
        campScope: camp.campId || camp._id,
      });
      usedNames.push(displayName, storedName);

      const tempPath = file.path;
      const finalPath = absoluteUploadPath(`camp-ops/${storedName}`);

      try {
        await renameLocalUpload(tempPath, finalPath, {
          contentType: file.mimetype,
          deferR2: false,
          originalName: displayName,
        });
      } catch (err) {
        console.error(
          `[camp-ops] direct confirm R2 persist failed camp=${camp.campId || camp._id} file=${storedName}:`,
          err?.message || err,
        );
        throw new AppError(
          `Could not store execution document “${displayName}” in cloud storage. Please try again.`,
          502,
          'UPLOAD_R2_FAILED',
        );
      }

      added.push({
        id: storedName,
        fileName: displayName,
        storedName,
        originalFileName: file.originalname,
        docType,
        ...(docNote ? { docNote } : {}),
        mimeType: file.mimetype,
        fileSize: file.size,
        url: `/uploads/camp-ops/${storedName}`,
        uploadedAt,
        storageStatus: 'ready',
      });
    }

    return { added };
  } finally {
    // Best-effort cleanup of direct-upload temp keys in R2
    for (const key of tempKeys) {
      try {
        await deleteObject(key);
      } catch {
        /* ignore */
      }
    }
  }
}

export { TEMP_PREFIX as DIRECT_UPLOAD_TEMP_PREFIX };
