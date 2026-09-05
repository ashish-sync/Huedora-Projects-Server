import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/helpers.js';
import { uploadDir } from '../../config/paths.js';
import {
  rejectUnsafeUploadedFiles,
  collectUploadedFiles,
  UPLOAD_RULES,
} from '../../utils/rejectUnsafeUpload.js';
import { createUploadStorage } from '../../storage/createUploadStorage.js';
import { uploadExists } from '../../storage/serveUpload.js';
import { deleteLocalUpload } from '../../storage/persistUpload.js';

export const assetRequestUploadRoot = uploadDir('asset-requests');

const IMAGE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/bmp': '.bmp',
};
const BILL_EXTENSIONS = {
  ...IMAGE_EXTENSIONS,
  'application/pdf': '.pdf',
};
const ATTACHMENT_EXTENSIONS = {
  ...BILL_EXTENSIONS,
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
};

const PRODUCT_PHOTO_RULES = {
  allowedExt: [...new Set([...UPLOAD_RULES.images.allowedExt, '.heic', '.heif', '.bmp'])],
};
const BILL_RULES = {
  allowedExt: [...new Set([...PRODUCT_PHOTO_RULES.allowedExt, '.pdf'])],
};
const ATTACHMENT_RULES = {
  allowedExt: [...new Set([...UPLOAD_RULES.anySafe.allowedExt, '.heic', '.heif', '.bmp'])],
};

const productPhotoMulter = multer({
  storage: createUploadStorage({
    destination: (_req, _file, cb) => cb(null, assetRequestUploadRoot),
  }),
  limits: { fileSize: env.uploadMaxBytes },
  fileFilter: (_req, file, cb) => {
    if (!IMAGE_EXTENSIONS[file.mimetype]) {
      return cb(new AppError('Product photo must be an image', 400, 'VALIDATION_ERROR'));
    }
    cb(null, true);
  },
}).single('productPhoto');

const reimbursementBillMulter = multer({
  storage: createUploadStorage({
    destination: (_req, _file, cb) => cb(null, assetRequestUploadRoot),
  }),
  limits: { fileSize: env.uploadMaxBytes },
  fileFilter: (_req, file, cb) => {
    if (!BILL_EXTENSIONS[file.mimetype]) {
      return cb(new AppError('Bill must be a PDF or image', 400, 'VALIDATION_ERROR'));
    }
    cb(null, true);
  },
}).single('bill');

const requestAttachmentMulter = multer({
  storage: createUploadStorage({
    destination: (_req, _file, cb) => cb(null, assetRequestUploadRoot),
  }),
  limits: { fileSize: env.uploadMaxBytes },
  fileFilter: (_req, file, cb) => {
    if (!ATTACHMENT_EXTENSIONS[file.mimetype]) {
      return cb(
        new AppError(
          'Attachment must be an image, PDF, Word, Excel, or text file',
          400,
          'VALIDATION_ERROR'
        )
      );
    }
    cb(null, true);
  },
}).single('attachment');

async function afterSafeUpload(req, next, error, rules, sizeMessage) {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return next(new AppError(sizeMessage, 413, 'FILE_TOO_LARGE'));
  }
  if (error instanceof multer.MulterError) {
    return next(new AppError(error.message, 400, 'UPLOAD_ERROR'));
  }
  if (error) return next(error);
  try {
    await rejectUnsafeUploadedFiles(collectUploadedFiles(req), rules);
    next();
  } catch (err) {
    next(err);
  }
}

export function productPhotoUpload(req, res, next) {
  productPhotoMulter(req, res, (error) => {
    afterSafeUpload(
      req,
      next,
      error,
      PRODUCT_PHOTO_RULES,
      'Product photo exceeds the upload size limit'
    );
  });
}

export function reimbursementBillUpload(req, res, next) {
  reimbursementBillMulter(req, res, (error) => {
    afterSafeUpload(req, next, error, BILL_RULES, 'Bill exceeds the upload size limit');
  });
}

export function requestAttachmentUpload(req, res, next) {
  requestAttachmentMulter(req, res, (error) => {
    afterSafeUpload(
      req,
      next,
      error,
      ATTACHMENT_RULES,
      'Attachment exceeds the upload size limit'
    );
  });
}

export function imageMetadata(file, source, actorId = null) {
  return {
    filename: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    source,
    uploadedById: actorId,
    uploadedAt: new Date().toISOString(),
  };
}

export function imageFilePath(image) {
  const filename = path.basename(String(image?.filename || ''));
  const uuidImage =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|gif|heic|heif|bmp)$/i;
  if (!filename || filename !== image?.filename || !uuidImage.test(filename)) return null;
  const resolved = path.resolve(assetRequestUploadRoot, filename);
  const rootPrefix = `${path.resolve(assetRequestUploadRoot)}${path.sep}`;
  return resolved.startsWith(rootPrefix) ? resolved : null;
}

export async function existingImageFilePath(image) {
  const filePath = imageFilePath(image);
  if (!filePath) return null;
  if (fs.existsSync(filePath)) {
    const realRoot = fs.realpathSync(assetRequestUploadRoot);
    const realFile = fs.realpathSync(filePath);
    return realFile.startsWith(`${realRoot}${path.sep}`) ? realFile : null;
  }
  if (await uploadExists(filePath)) return filePath;
  return null;
}

export async function existingAttachmentFilePath(attachment) {
  const filename = path.basename(String(attachment?.filename || ''));
  const allowedFile =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|gif|heic|heif|bmp|pdf|doc|docx|xls|xlsx|txt)$/i;
  if (!filename || filename !== attachment?.filename || !allowedFile.test(filename)) return null;
  const resolved = path.resolve(assetRequestUploadRoot, filename);
  const rootPrefix = `${path.resolve(assetRequestUploadRoot)}${path.sep}`;
  if (!resolved.startsWith(rootPrefix)) return null;
  if (fs.existsSync(resolved)) {
    const realRoot = fs.realpathSync(assetRequestUploadRoot);
    const realFile = fs.realpathSync(resolved);
    return realFile.startsWith(`${realRoot}${path.sep}`) ? realFile : null;
  }
  if (await uploadExists(resolved)) return resolved;
  return null;
}

export function removeImageFile(image) {
  const filePath = imageFilePath(image);
  if (filePath) {
    deleteLocalUpload(filePath).catch(() => {});
  }
}

export function removeAttachmentFile(attachment) {
  const filename = path.basename(String(attachment?.filename || ''));
  if (!filename) return;
  const resolved = path.resolve(assetRequestUploadRoot, filename);
  deleteLocalUpload(resolved).catch(() => {});
}
