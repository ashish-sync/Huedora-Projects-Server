import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '../..');

export const dataDir = env.dataDir
  ? path.resolve(env.dataDir)
  : path.join(serverRoot, 'data');

export const uploadsRoot = env.uploadsDir
  ? path.resolve(env.uploadsDir)
  : path.join(serverRoot, 'uploads');

/** Resolve a subdirectory under the uploads root (e.g. `agreements`, `camp-ops`). */
export function uploadDir(...segments) {
  return path.join(uploadsRoot, ...segments);
}

const UPLOAD_SUBDIRS = [
  'agreements',
  'asset-requests',
  'camp-ops',
  'finance',
  'import-errors',
  'import-temp',
  'logistics',
  'logistics/products',
  'previews',
  'templates',
  'tmp',
  'verifications',
];

/** Ensure all known upload directories exist (supports UPLOADS_DIR on Render persistent disk). */
export function ensureUploadDirs() {
  fs.mkdirSync(uploadsRoot, { recursive: true });
  for (const sub of UPLOAD_SUBDIRS) {
    fs.mkdirSync(uploadDir(...sub.split('/')), { recursive: true });
  }
}
