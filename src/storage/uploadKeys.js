import path from 'path';
import { uploadsRoot } from '../config/paths.js';

/**
 * Normalize any stored URL/path/abs path to a forward-slash object key under uploads.
 * Returns '' when outside uploads root or empty.
 */
export function toUploadObjectKey(absOrRelOrUrl = '') {
  let raw = String(absOrRelOrUrl || '').trim();
  if (!raw) return '';

  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      raw = u.pathname || '';
    }
  } catch {
    /* keep raw */
  }

  raw = raw.replace(/\\/g, '/');
  if (raw.includes('/files/signed')) return '';

  const uploadsMatch = raw.match(/\/uploads\/(.+)$/i);
  if (uploadsMatch) {
    return sanitizeKey(uploadsMatch[1]);
  }

  if (/^uploads\//i.test(raw)) {
    return sanitizeKey(raw.replace(/^uploads\//i, ''));
  }

  // Absolute path under uploadsRoot
  try {
    const root = path.resolve(uploadsRoot);
    const full = path.resolve(raw);
    const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (full === root) return '';
    if (full.startsWith(rootWithSep)) {
      return sanitizeKey(path.relative(root, full));
    }
  } catch {
    /* fall through */
  }

  // Relative key already
  if (!path.isAbsolute(raw) && !raw.includes('://')) {
    return sanitizeKey(raw.replace(/^\/+/, '').replace(/^uploads\/+/i, ''));
  }

  return '';
}

function sanitizeKey(key) {
  let k = String(key || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  try {
    k = decodeURIComponent(k);
  } catch {
    /* keep */
  }
  const parts = k.split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') return '';
    out.push(part);
  }
  return out.join('/');
}

/** Absolute disk path for an object key. */
export function absoluteUploadPath(objectKey) {
  const key = toUploadObjectKey(objectKey);
  if (!key) {
    throw new Error('Invalid upload object key');
  }
  const root = path.resolve(uploadsRoot);
  const full = path.resolve(uploadsRoot, key);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (full !== root && !full.startsWith(rootWithSep)) {
    throw new Error('Upload path escapes uploads root');
  }
  return full;
}

/** Public DB-style path `/uploads/<key>`. */
export function publicUploadPath(objectKey) {
  const key = toUploadObjectKey(objectKey);
  return key ? `/uploads/${key}` : '';
}
