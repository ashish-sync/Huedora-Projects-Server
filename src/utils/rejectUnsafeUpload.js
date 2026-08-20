/**
 * Shared post-multer upload check (disk or memory).
 * Rejects executables and magic/extension mismatches; unlinks disk files on failure.
 */
import fs from 'fs';
import { AppError, asyncHandler } from './helpers.js';
import { assertSafeUpload } from './uploadSafety.js';

export function collectUploadedFiles(req) {
  const out = [];
  if (req.file) out.push(req.file);
  if (Array.isArray(req.files)) {
    out.push(...req.files);
  } else if (req.files && typeof req.files === 'object') {
    for (const value of Object.values(req.files)) {
      if (Array.isArray(value)) out.push(...value);
      else if (value) out.push(value);
    }
  }
  return out.filter(Boolean);
}

export async function rejectUnsafeUploadedFiles(files, rules = {}) {
  const list = Array.isArray(files) ? files.filter(Boolean) : files ? [files] : [];
  for (const file of list) {
    let buffer = file.buffer;
    if (!Buffer.isBuffer(buffer) && file.path) {
      try {
        const fd = fs.openSync(file.path, 'r');
        buffer = Buffer.alloc(16);
        fs.readSync(fd, buffer, 0, 16, 0);
        fs.closeSync(fd);
      } catch {
        buffer = Buffer.alloc(0);
      }
    }
    const check = assertSafeUpload(
      {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        buffer,
      },
      rules
    );
    if (!check.ok) {
      if (file.path) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          /* ignore */
        }
      }
      throw new AppError(check.message, 400, 'UPLOAD_REJECTED');
    }
  }
}

/** Express middleware: validate every multer file on the request. */
export function requireSafeUploads(rules = {}) {
  return asyncHandler(async (req, _res, next) => {
    await rejectUnsafeUploadedFiles(collectUploadedFiles(req), rules);
    next();
  });
}

export const UPLOAD_RULES = {
  documents: {
    allowedExt: ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.xlsx', '.xls', '.csv', '.docx'],
  },
  images: {
    allowedExt: ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
  },
  office: {
    allowedExt: ['.pdf', '.doc', '.docx', '.xlsx', '.xls', '.csv', '.png', '.jpg', '.jpeg'],
  },
  spreadsheet: {
    allowedExt: ['.xlsx', '.xls', '.xlsb', '.csv'],
  },
  anySafe: {
    allowedExt: [
      '.pdf',
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.webp',
      '.doc',
      '.docx',
      '.xlsx',
      '.xls',
      '.xlsb',
      '.csv',
      '.txt',
    ],
  },
};
