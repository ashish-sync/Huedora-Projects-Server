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

/** Keys to try when masters were rewritten (jpg→webp) or remapped in StoredFile. */
async function candidateObjectKeys(objectKey) {
  const keys = [];
  const push = (k) => {
    const key = String(k || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (key && !keys.includes(key)) keys.push(key);
  };
  push(objectKey);
  push(siblingWebpObjectKey(objectKey));
  try {
    const { StoredFile } = await import('../modules/files/storedFile.model.js');
    for (const k of [...keys]) {
      const row = await StoredFile.findOne({ objectKey: k, isDeleted: false });
      if (row?.objectKey) push(row.objectKey);
    }
    // Stale .jpg/.png rows after optimize: registry often has the .webp master only.
    const webp = siblingWebpObjectKey(objectKey);
    if (webp) {
      const webpRow = await StoredFile.findOne({ objectKey: webp, isDeleted: false });
      if (webpRow?.objectKey) push(webpRow.objectKey);
    }
  } catch {
    /* registry optional during early boot / tests */
  }
  return keys;
}

/**
 * Resolve a relative upload path and ensure the object exists (disk or R2).
 * Returns { objectKey, absPath, onDisk }.
 */
export async function resolveUploadLocation(relativePath) {
  const objectKey = toUploadObjectKey(relativePath);
  if (!objectKey) {
    throw new AppError('Invalid file path', 400, 'VALIDATION_ERROR');
  }

  const keys = await candidateObjectKeys(objectKey);

  for (const key of keys) {
    try {
      await ensureHotStorage(key);
    } catch (err) {
      console.warn(`[storage] restore before resolve failed: ${err?.message || err}`);
    }

    let absPath;
    try {
      absPath = absoluteUploadPath(key);
    } catch {
      continue;
    }

    if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
      return { objectKey: key, absPath, onDisk: true };
    }

    if (isObjectStoreEnabled()) {
      try {
        const meta = await headObject(key);
        if (meta) {
          return {
            objectKey: key,
            absPath,
            onDisk: false,
            contentType: meta.ContentType || (key.endsWith('.webp') ? 'image/webp' : undefined),
          };
        }
      } catch (err) {
        console.warn(`[storage] headObject failed key=${key}: ${err?.message || err}`);
      }
    }
  }

  throw new AppError('File not found', 404, 'NOT_FOUND');
}

/** When an image master was rewritten to .webp, map the stale pre-optimize key. */
export function siblingWebpObjectKey(objectKey = '') {
  const key = String(objectKey || '').replace(/\\/g, '/');
  if (!key || key.toLowerCase().endsWith('.webp')) return '';
  if (!/\.(jpe?g|png|gif|bmp|tiff?)$/i.test(key)) return '';
  return key.replace(/\.[^.]+$/, '.webp');
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
  const primary = toUploadObjectKey(absOrKey);
  if (!primary) throw new AppError('Invalid file path', 400, 'VALIDATION_ERROR');

  const keys = await candidateObjectKeys(primary);
  for (const key of keys) {
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
      continue;
    }

    if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
      return {
        stream: fs.createReadStream(absPath),
        contentType: key.endsWith('.webp') ? 'image/webp' : undefined,
        from: 'disk',
      };
    }

    if (isObjectStoreEnabled()) {
      try {
        const obj = await getObject(key);
        if (obj?.Body) {
          return {
            stream: obj.Body,
            contentType: obj.ContentType || (key.endsWith('.webp') ? 'image/webp' : undefined),
            from: 'r2',
          };
        }
      } catch (err) {
        console.warn(`[storage] getObject failed key=${key}: ${err?.message || err}`);
      }
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
  const primary = toUploadObjectKey(absOrKey);
  if (!primary) throw new AppError('Invalid file path', 400, 'VALIDATION_ERROR');

  const keys = await candidateObjectKeys(primary);
  for (const key of keys) {
    try {
      await ensureHotStorage(key);
    } catch (err) {
      console.warn(`[storage] restore before ensureLocal failed: ${err?.message || err}`);
    }
    void touchStoredFileAccess(key);

    let absPath;
    try {
      absPath = absoluteUploadPath(key);
    } catch {
      continue;
    }
    if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) return absPath;

    if (!isObjectStoreEnabled()) continue;
    try {
      const obj = await getObject(key);
      if (!obj?.Body) continue;
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      await pipeline(obj.Body, fs.createWriteStream(absPath));
      return absPath;
    } catch (err) {
      console.warn(`[storage] ensureLocal getObject failed key=${key}: ${err?.message || err}`);
    }
  }

  throw new AppError('File not found', 404, 'NOT_FOUND');
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
