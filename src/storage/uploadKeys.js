import path from 'path';
import { randomUUID } from 'crypto';
import { uploadsRoot } from '../config/paths.js';

/**
 * TYLO One stored-file naming (disk under uploads/ + Cloudflare R2 object key)
 * =============================================================================
 *
 * Full object key:
 *   {moduleFolder}/…/{basename}
 *
 * moduleFolder comes from uploadDir(...) / destination (examples):
 *   logistics, logistics/products, contacts, camp-ops, finance,
 *   finance-vendor-bills, agreements, templates, verifications,
 *   asset-requests, documents/{entityType}/{entityId}
 *
 * Basename (always):
 *   [{purpose}__]{yyyyMMdd}-{id8}__{safeOriginal}
 *
 * Examples:
 *   logistics/products/20260906-a1b2c3d4__sku_photo.jpg
 *   contacts/20260906-9f8e7d6c__pan_card.pdf
 *   camp-ops/po__20260906-11223344__approval.pdf
 *   finance/20260906-aabbccdd__Tax_Invoice.pdf
 *
 * Rules:
 * 1. Safe original = letters, digits, `.` `_` `-` only; spaces → `_`; max 80 chars; keep extension.
 * 2. id8 = first 8 hex chars of a UUID (collision-safe, short enough to skim in R2).
 * 3. yyyyMMdd = upload date (UTC) for sorting / ops search.
 * 4. Optional purpose prefix (po, ctf, signed, preview, filled) when the same folder holds many kinds.
 * 5. Human display / original name stays in the DB (`name`, `originalName`, `fileName`, …).
 * 6. Never rewrite existing keys — old timestamp/uuid patterns keep working via toUploadObjectKey.
 *
 * Exception: Camp execution finals use semantic names from `executionDocumentName.js`:
 * display `{DOCTOR}{DF|PF|GS|OT}.ext`, stored `{campId}__{DOCTOR}{CODE}.ext`
 * (e.g. `ADIPF.webp` / `26-10-0001__ADIPF.webp`) — no camp-date suffix.
 */

const SAFE_NAME_MAX = 80;

/** @param {string} [originalName] */
export function sanitizeOriginalFileName(originalName = 'file') {
  const raw = String(originalName || 'file').trim() || 'file';
  const ext = path.extname(raw);
  const stem = path.basename(raw, ext) || 'file';
  const safeStem = stem.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'file';
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
  const combined = `${safeStem}${safeExt}`;
  if (combined.length <= SAFE_NAME_MAX) return combined;
  const room = Math.max(8, SAFE_NAME_MAX - safeExt.length);
  return `${safeStem.slice(0, room)}${safeExt}`;
}

/** @param {Date|number|string} [now] */
export function formatUploadDateStamp(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) return formatUploadDateStamp(new Date());
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * Build the stored basename for a new upload (not a full key).
 *
 * @param {string} [originalName]
 * @param {{ purpose?: string, now?: Date|number|string, id?: string }} [options]
 */
export function buildStoredUploadFileName(originalName = 'file', options = {}) {
  const purpose = String(options.purpose || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
  const idSource = String(options.id || randomUUID()).replace(/-/g, '');
  const id8 = idSource.slice(0, 8) || randomUUID().replace(/-/g, '').slice(0, 8);
  const stamp = formatUploadDateStamp(options.now);
  const safe = sanitizeOriginalFileName(originalName);
  const core = `${stamp}-${id8}__${safe}`;
  return purpose ? `${purpose}__${core}` : core;
}

/** Multer filename callback — standard convention. */
export function multerStoredUploadFileName(_req, file, cb) {
  try {
    cb(null, buildStoredUploadFileName(file?.originalname));
  } catch (err) {
    cb(err);
  }
}

/**
 * Multer filename callback with a fixed purpose prefix (e.g. po, ctf, signed).
 * @param {string} purpose
 */
export function multerStoredUploadFileNameWithPurpose(purpose) {
  return function multerPurposeFileName(_req, file, cb) {
    try {
      cb(null, buildStoredUploadFileName(file?.originalname, { purpose }));
    } catch (err) {
      cb(err);
    }
  };
}

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
