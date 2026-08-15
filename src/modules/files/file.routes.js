import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler, AppError } from '../../utils/helpers.js';
import { env } from '../../config/env.js';
import { uploadsRoot } from '../../config/paths.js';

const router = Router();

/**
 * Resolve a relative path under uploadsRoot safely.
 * Accepts `camp-ops/a.pdf`, `/uploads/camp-ops/a.pdf`, or URL-encoded segments.
 */
export function resolveUploadPath(relativePath) {
  let raw = String(relativePath || '').trim();
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  raw = raw.replace(/^\/+/, '').replace(/^uploads\/+/i, '');
  const normalized = path.normalize(raw).replace(/^(\.\.(\/|\\|$))+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('..')) {
    throw new AppError('Invalid file path', 400, 'VALIDATION_ERROR');
  }
  const root = path.resolve(uploadsRoot);
  const full = path.resolve(uploadsRoot, normalized);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (full !== root && !full.startsWith(rootWithSep)) {
    throw new AppError('Invalid file path', 400, 'VALIDATION_ERROR');
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new AppError('File not found', 404, 'NOT_FOUND');
  }
  return full;
}

/** Strip host + `/uploads/` prefix → relative storage path. */
export function relativeUploadPathFromUrl(urlOrPath = '') {
  const raw = String(urlOrPath || '').trim();
  if (!raw) return '';
  if (raw.includes('/files/signed')) return '';
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      const p = u.pathname || '';
      const match = p.match(/\/uploads\/(.+)$/i);
      return match ? decodeURIComponent(match[1]) : '';
    }
  } catch {
    /* fall through */
  }
  const match = raw.match(/\/uploads\/(.+)$/i);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  if (!raw.startsWith('/') && !raw.includes('://')) {
    return raw.replace(/^uploads\/+/i, '');
  }
  return '';
}

export function signUploadFileUrl(relativePath, { expiresIn = '1h' } = {}) {
  const cleaned = String(relativePath || '')
    .replace(/^\/+/, '')
    .replace(/^uploads\/+/i, '');
  const token = jwt.sign(
    { kind: 'file', path: cleaned },
    env.jwtAccessSecret,
    { expiresIn },
  );
  return `/api/v1/files/signed?token=${encodeURIComponent(token)}`;
}

/**
 * Convert any stored `/uploads/...` (or absolute upload URL) into a short-lived
 * signed `/api/v1/files/signed` link. Leaves non-upload / already-signed URLs as-is.
 * Does not move or rewrite files on disk — safe for existing uploads.
 */
export function toSignedUploadUrl(urlOrPath, opts) {
  const raw = String(urlOrPath || '').trim();
  if (!raw) return '';
  if (raw.includes('/files/signed')) return raw;
  const relative = relativeUploadPathFromUrl(raw);
  if (!relative) return raw;
  return signUploadFileUrl(relative, opts);
}

router.get(
  '/signed',
  asyncHandler(async (req, res) => {
    const raw = String(req.query.token || '').trim();
    if (!raw) throw new AppError('Missing file token', 400, 'VALIDATION_ERROR');
    let payload;
    try {
      payload = jwt.verify(raw, env.jwtAccessSecret);
    } catch {
      throw new AppError('Invalid or expired file link', 401, 'UNAUTHORIZED');
    }
    if (payload?.kind !== 'file' || !payload?.path) {
      throw new AppError('Invalid file token', 400, 'VALIDATION_ERROR');
    }
    const full = resolveUploadPath(payload.path);
    res.sendFile(full);
  }),
);

router.get(
  '/*',
  authenticate,
  asyncHandler(async (req, res) => {
    const relative = String(req.path || '').replace(/^\/+/, '');
    const full = resolveUploadPath(relative);
    res.sendFile(full);
  }),
);

export default router;
