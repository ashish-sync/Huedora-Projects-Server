import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { pipeline } from 'stream/promises';
import { uploadsRoot, uploadDir } from '../../config/paths.js';
import { generateImagePreviewWebp } from './optimizeImage.js';
import { toUploadObjectKey, absoluteUploadPath } from '../uploadKeys.js';
import { classifyUploadKind } from './mediaKinds.js';
import { isObjectStoreEnabled, getObject } from '../objectStore.js';

const THUMB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cacheDir() {
  return uploadDir('cache', 'thumbs');
}

function thumbPath(contentHashOrKey, width) {
  const id = createHash('sha256')
    .update(String(contentHashOrKey))
    .digest('hex')
    .slice(0, 24);
  return path.join(cacheDir(), `${id}-w${width}.webp`);
}

async function ensureMasterLocal(objectKey) {
  const absPath = absoluteUploadPath(objectKey);
  if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) return absPath;
  if (!isObjectStoreEnabled()) {
    throw new Error('Master file not found for preview');
  }
  const obj = await getObject(objectKey);
  if (!obj?.Body) throw new Error('Master file not found for preview');
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  await pipeline(obj.Body, fs.createWriteStream(absPath));
  return absPath;
}

/**
 * On-demand image preview. Disposable cache under uploads/cache/thumbs.
 * PDFs and non-images return null (callers stream the master instead).
 */
export async function getOrCreateImagePreview(
  absOrKey,
  { width = 240, originalName = '', contentType = '' } = {},
) {
  const kind = classifyUploadKind({
    originalName: originalName || absOrKey,
    mimetype: contentType,
  });
  if (kind !== 'image') return null;

  const objectKey = toUploadObjectKey(absOrKey);
  if (!objectKey) return null;

  const w = Math.min(1200, Math.max(48, Number(width) || 240));
  const dest = thumbPath(objectKey, w);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(dest)) {
    const age = Date.now() - fs.statSync(dest).mtimeMs;
    if (age < THUMB_TTL_MS) {
      return { absPath: dest, contentType: 'image/webp', cached: true };
    }
  }

  const masterAbs = await ensureMasterLocal(objectKey);
  const buffer = await generateImagePreviewWebp(masterAbs, { width: w });
  fs.writeFileSync(dest, buffer);
  return { absPath: dest, contentType: 'image/webp', cached: false };
}

/** Delete thumb cache files older than TTL. */
export function sweepExpiredThumbCache({ olderThanMs = THUMB_TTL_MS } = {}) {
  const dir = cacheDir();
  if (!fs.existsSync(dir)) return { removed: 0 };
  let removed = 0;
  const now = Date.now();
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      if (now - st.mtimeMs > olderThanMs) {
        fs.unlinkSync(full);
        removed += 1;
      }
    } catch {
      /* ignore */
    }
  }
  return { removed };
}

export function thumbCacheRoot() {
  return path.join(uploadsRoot, 'cache', 'thumbs');
}
