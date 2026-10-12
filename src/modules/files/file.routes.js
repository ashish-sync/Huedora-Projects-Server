import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler, AppError } from '../../utils/helpers.js';
import { env } from '../../config/env.js';
import { uploadsRoot } from '../../config/paths.js';
import { sendUploadFile } from '../../storage/serveUpload.js';

const router = Router();

/**
 * Resolve a relative path under uploadsRoot safely (disk existence required).
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

/**
 * Recover durable relative path from a (possibly expired) signed file URL.
 * Uses jwt.decode — does not require a still-valid signature/expiry.
 */
export function relativeUploadPathFromSignedUrl(urlOrPath = '') {
  const raw = String(urlOrPath || '').trim();
  if (!raw || !raw.includes('/files/signed')) return '';
  try {
    let token = '';
    if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) {
      const u = new URL(raw, 'http://local.invalid');
      token = u.searchParams.get('token') || '';
    }
    if (!token && raw.includes('token=')) {
      token = decodeURIComponent(String(raw.split('token=')[1] || '').split('&')[0] || '');
    }
    if (!token) return '';
    const payload = jwt.decode(token);
    if (payload?.kind !== 'file' || !payload?.path) return '';
    return String(payload.path)
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/^uploads\/+/i, '');
  } catch {
    return '';
  }
}

/** Relative key from /uploads path or recoverable signed token. */
export function durableUploadRelativePath(urlOrPath = '') {
  const raw = String(urlOrPath || '').trim();
  if (!raw) return '';
  return relativeUploadPathFromSignedUrl(raw) || relativeUploadPathFromUrl(raw);
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
 * signed `/api/v1/files/signed` link. Re-mints a fresh token when given an
 * already-signed (even expired) URL so Master One View links keep working.
 */
export function toSignedUploadUrl(urlOrPath, opts) {
  const raw = String(urlOrPath || '').trim();
  if (!raw) return '';
  const relative = durableUploadRelativePath(raw);
  if (!relative) {
    // Non-upload API paths (e.g. document download) stay unchanged.
    if (raw.includes('/files/signed')) return '';
    return raw;
  }
  return signUploadFileUrl(relative, opts);
}

router.post(
  '/sign',
  authenticate,
  asyncHandler(async (req, res) => {
    const pathOrUrl = String(req.body?.path || req.body?.url || '').trim();
    if (!pathOrUrl) throw new AppError('path is required', 400, 'VALIDATION_ERROR');
    const signed = toSignedUploadUrl(pathOrUrl);
    if (!signed || !signed.includes('/files/signed')) {
      throw new AppError('Not an upload path', 400, 'VALIDATION_ERROR');
    }
    res.json({ data: { url: signed } });
  }),
);

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
    await sendUploadFile(res, payload.path, {
      preview: ['1', 'true', 'yes'].includes(String(req.query.preview || '').toLowerCase()),
      previewWidth: Number(req.query.w) || 240,
    });
  }),
);

/** Path-based file serving is disabled — use entity download routes or signed URLs. */
router.get(
  '/*',
  authenticate,
  asyncHandler(async (_req, _res) => {
    throw new AppError(
      'Direct file path access is disabled. Use a signed file link or the module download API.',
      403,
      'FORBIDDEN'
    );
  }),
);

export default router;
