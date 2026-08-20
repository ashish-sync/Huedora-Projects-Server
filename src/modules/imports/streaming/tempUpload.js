import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import { uploadDir } from '../../../config/paths.js';
import {
  MAX_SPREADSHEET_UPLOAD_BYTES,
  IMPORT_ACCEPT_EXTENSIONS,
} from '../../../utils/spreadsheetLimits.js';
import { importAppError, describeImportFileProblem } from '../../../utils/importErrors.js';
import { assertSafeUpload } from '../../../utils/uploadSafety.js';

export const importTempRoot = uploadDir('import-temp');

const ALLOWED = new Set(IMPORT_ACCEPT_EXTENSIONS);

function ensureTempRoot() {
  fs.mkdirSync(importTempRoot, { recursive: true });
}

export function assertImportExtension(originalname) {
  const ext = path.extname(String(originalname || '')).toLowerCase();
  if (!ALLOWED.has(ext)) {
    throw importAppError('BAD_EXTENSION');
  }
  return ext;
}

/** Multer disk storage — file lands under import-temp, never kept after job ends. */
export const tabularImportUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        ensureTempRoot();
        cb(null, importTempRoot);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(String(file.originalname || '')).toLowerCase() || '.csv';
      cb(null, `${Date.now()}_${uuid()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_SPREADSHEET_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    try {
      assertImportExtension(file.originalname);
      cb(null, true);
    } catch (err) {
      cb(err);
    }
  },
});

export function validateUploadedImportFile(file) {
  const pre = describeImportFileProblem(file);
  if (pre && !file?.path) throw importAppError(pre);
  if (!file?.path) throw importAppError('FILE_REQUIRED');
  const ext = assertImportExtension(file.originalname || file.path);
  if (!fs.existsSync(file.path)) {
    throw importAppError('TEMP_MISSING');
  }
  const size = Number(file.size) || fs.statSync(file.path).size;
  if (size > MAX_SPREADSHEET_UPLOAD_BYTES) {
    safeUnlink(file.path);
    throw importAppError('TOO_LARGE');
  }
  if (size <= 0) {
    safeUnlink(file.path);
    throw importAppError('EMPTY_FILE');
  }
  let head = Buffer.alloc(0);
  try {
    const fd = fs.openSync(file.path, 'r');
    head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
  } catch {
    head = Buffer.alloc(0);
  }
  const check = assertSafeUpload(
    { originalname: file.originalname, mimetype: file.mimetype, size, buffer: head },
    { allowedExt: [...IMPORT_ACCEPT_EXTENSIONS], maxBytes: MAX_SPREADSHEET_UPLOAD_BYTES }
  );
  if (!check.ok) {
    safeUnlink(file.path);
    const err = importAppError('BAD_EXTENSION');
    err.message = check.message || err.message;
    throw err;
  }
  return { ...file, ext, size };
}

export function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

/** Best-effort cleanup of temp files older than maxAgeMs (default 1h). */
export function cleanupStaleImportTemps(maxAgeMs = 60 * 60 * 1000) {
  ensureTempRoot();
  const now = Date.now();
  for (const name of fs.readdirSync(importTempRoot)) {
    const full = path.join(importTempRoot, name);
    try {
      const st = fs.statSync(full);
      if (now - st.mtimeMs > maxAgeMs) fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
}
