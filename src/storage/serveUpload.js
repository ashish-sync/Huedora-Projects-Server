import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { AppError } from '../utils/helpers.js';
import { uploadsRoot } from '../config/paths.js';
import { isObjectStoreEnabled, getObject, headObject } from './objectStore.js';
import { toUploadObjectKey, absoluteUploadPath } from './uploadKeys.js';
import { touchStoredFileAccess } from './media/touchAccess.js';
import { ensureHotStorage } from './media/ensureHotStorage.js';
import { getOrCreateImagePreview } from './media/thumbCache.js';

/**
 * Resolve a relative upload path and ensure the object exists (disk or R2).
 * Returns { objectKey, absPath, onDisk }.
 */
export async function resolveUploadLocation(relativePath) {
  const objectKey = toUploadObjectKey(relativePath);
  if (!objectKey) {
    throw new AppError('Invalid file path', 400, 'VALIDATION_ERROR');
  }

  let absPath;
  try {
    absPath = absoluteUploadPath(objectKey);
  } catch {
    throw new AppError('Invalid file path', 400, 'VALIDATION_ERROR');
  }

  // Auto-restore from Infrequent Access before resolving
  try {
    await ensureHotStorage(objectKey);
  } catch (err) {
    console.warn(`[storage] restore before resolve failed: ${err?.message || err}`);
  }

  if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
    return { objectKey, absPath, onDisk: true };
  }

  if (isObjectStoreEnabled()) {
    const meta = await headObject(objectKey);
    if (meta) {
      return { objectKey, absPath, onDisk: false, contentType: meta.ContentType };
    }
  }

  throw new AppError('File not found', 404, 'NOT_FOUND');
}

/**
 * True if file exists on disk or in R2.
 */
export async function uploadExists(absOrKey) {
  const key = toUploadObjectKey(absOrKey);
  if (!key) return false;
  try {
    const abs = absoluteUploadPath(key);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return true;
  } catch {
    /* ignore */
  }
  if (isObjectStoreEnabled()) {
    const meta = await headObject(key);
    return Boolean(meta);
  }
  return false;
}

/**
 * Open a readable stream from disk or R2.
 * @returns {Promise<{ stream: NodeJS.ReadableStream, contentType?: string, from: 'disk'|'r2' }>}
 */
export async function openUploadReadStream(absOrKey) {
  const key = toUploadObjectKey(absOrKey);
  if (!key) throw new AppError('Invalid file path', 400, 'VALIDATION_ERROR');

  try {
    await ensureHotStorage(key);
  } catch (err) {
    console.warn(`[storage] restore before open failed: ${err?.message || err}`);
  }
  void touchStoredFileAccess(key);

  let absPath;
  try {
    absPath = absoluteUploadPath(key);
  } catch {
    throw new AppError('Invalid file path', 400, 'VALIDATION_ERROR');
  }

  if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
    return {
      stream: fs.createReadStream(absPath),
      from: 'disk',
    };
  }

  if (isObjectStoreEnabled()) {
    const obj = await getObject(key);
    if (obj?.Body) {
      return {
        stream: obj.Body,
        contentType: obj.ContentType,
        from: 'r2',
      };
    }
  }

  throw new AppError('File not found', 404, 'NOT_FOUND');
}

/**
 * Stream an upload to an Express response (download or inline).
 * Optional preview=true|1 generates a disposable image thumb (not for PDFs).
 */
export async function sendUploadFile(res, absOrKey, {
  downloadName,
  contentType,
  inline = false,
  preview = false,
  previewWidth = 240,
} = {}) {
  const keyHint = toUploadObjectKey(absOrKey);
  if (keyHint) {
    void touchStoredFileAccess(keyHint);
  }

  if (preview) {
    try {
      const thumb = await getOrCreateImagePreview(absOrKey, {
        width: previewWidth,
        originalName: downloadName || absOrKey,
        contentType,
      });
      if (thumb?.absPath) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.type(thumb.contentType);
        return new Promise((resolve, reject) => {
          res.sendFile(thumb.absPath, (err) => (err ? reject(err) : resolve()));
        });
      }
    } catch (err) {
      console.warn(`[storage] preview generation failed: ${err?.message || err}`);
      // fall through to master
    }
  }

  const loc = await resolveUploadLocation(absOrKey);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');

  if (loc.onDisk) {
    if (downloadName) {
      return new Promise((resolve, reject) => {
        res.download(loc.absPath, downloadName, (err) => (err ? reject(err) : resolve()));
      });
    }
    if (contentType) res.type(contentType);
    return new Promise((resolve, reject) => {
      res.sendFile(loc.absPath, (err) => (err ? reject(err) : resolve()));
    });
  }

  const obj = await getObject(loc.objectKey);
  if (!obj?.Body) throw new AppError('File not found', 404, 'NOT_FOUND');
  const type = contentType || obj.ContentType || loc.contentType || 'application/octet-stream';
  res.type(type);
  if (downloadName) {
    const safe = String(downloadName).replace(/[^\w.\- ()[\]]+/g, '_');
    const disposition = inline ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${safe}"`);
  }
  if (obj.ContentLength != null) {
    res.setHeader('Content-Length', String(obj.ContentLength));
  }
  await pipeline(obj.Body, res);
}

/**
 * Pipe upload bytes to response without Content-Disposition (legacy createReadStream sites).
 */
export async function pipeUploadToResponse(res, absOrKey, { contentType } = {}) {
  const opened = await openUploadReadStream(absOrKey);
  if (contentType || opened.contentType) {
    res.type(contentType || opened.contentType);
  }
  await pipeline(opened.stream, res);
}

/**
 * Ensure the object exists on local disk (download from R2 if needed).
 * Useful for legacy sync readers (readFileSync, LibreOffice conversion).
 */
export async function ensureLocalUpload(absOrKey) {
  const key = toUploadObjectKey(absOrKey);
  if (!key) throw new AppError('Invalid file path', 400, 'VALIDATION_ERROR');

  try {
    await ensureHotStorage(key);
  } catch (err) {
    console.warn(`[storage] restore before ensureLocal failed: ${err?.message || err}`);
  }
  void touchStoredFileAccess(key);

  const absPath = absoluteUploadPath(key);
  if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) return absPath;

  if (!isObjectStoreEnabled()) {
    throw new AppError('File not found', 404, 'NOT_FOUND');
  }
  const obj = await getObject(key);
  if (!obj?.Body) throw new AppError('File not found', 404, 'NOT_FOUND');

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  await pipeline(obj.Body, fs.createWriteStream(absPath));
  return absPath;
}

/** Sync disk-only check used by legacy code paths during gradual migration. */
export function uploadExistsOnDisk(absOrKey) {
  const key = toUploadObjectKey(absOrKey);
  if (!key) return false;
  try {
    const abs = absoluteUploadPath(key);
    return fs.existsSync(abs) && fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

export function uploadsRootPath() {
  return uploadsRoot;
}

export function guessContentTypeFromName(name = '') {
  const ext = path.extname(String(name)).toLowerCase();
  const map = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] || undefined;
}
