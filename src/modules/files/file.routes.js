import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler, AppError } from '../../utils/helpers.js';
import { env } from '../../config/env.js';
import { uploadsRoot } from '../../config/paths.js';

const router = Router();

function resolveUploadPath(relativePath) {
  const normalized = path.normalize(String(relativePath || '')).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.resolve(uploadsRoot, normalized);
  if (!full.startsWith(path.resolve(uploadsRoot))) {
    throw new AppError('Invalid file path', 400, 'VALIDATION_ERROR');
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new AppError('File not found', 404, 'NOT_FOUND');
  }
  return full;
}

export function signUploadFileUrl(relativePath, { expiresIn = '1h' } = {}) {
  const token = jwt.sign(
    { kind: 'file', path: String(relativePath || '').replace(/^\/+/, '') },
    env.jwtAccessSecret,
    { expiresIn },
  );
  return `/api/v1/files/signed?token=${encodeURIComponent(token)}`;
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
