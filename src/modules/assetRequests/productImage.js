import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const assetRequestUploadRoot = path.resolve(__dirname, '../../../uploads/asset-requests');
fs.mkdirSync(assetRequestUploadRoot, { recursive: true });

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

const productPhotoMulter = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, assetRequestUploadRoot),
    filename: (_req, file, cb) => cb(null, `${uuid()}${IMAGE_EXTENSIONS[file.mimetype]}`),
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
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, assetRequestUploadRoot),
    filename: (_req, file, cb) => cb(null, `${uuid()}${BILL_EXTENSIONS[file.mimetype]}`),
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
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, assetRequestUploadRoot),
    filename: (_req, file, cb) => cb(null, `${uuid()}${ATTACHMENT_EXTENSIONS[file.mimetype]}`),
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

export function productPhotoUpload(req, res, next) {
  productPhotoMulter(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('Product photo exceeds the upload size limit', 413, 'FILE_TOO_LARGE'));
    }
    if (error instanceof multer.MulterError) {
      return next(new AppError(error.message, 400, 'UPLOAD_ERROR'));
    }
    return error ? next(error) : next();
  });
}

export function reimbursementBillUpload(req, res, next) {
  reimbursementBillMulter(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('Bill exceeds the upload size limit', 413, 'FILE_TOO_LARGE'));
    }
    if (error instanceof multer.MulterError) {
      return next(new AppError(error.message, 400, 'UPLOAD_ERROR'));
    }
    return error ? next(error) : next();
  });
}

export function requestAttachmentUpload(req, res, next) {
  requestAttachmentMulter(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(
        new AppError('Attachment exceeds the upload size limit', 413, 'FILE_TOO_LARGE')
      );
    }
    if (error instanceof multer.MulterError) {
      return next(new AppError(error.message, 400, 'UPLOAD_ERROR'));
    }
    return error ? next(error) : next();
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

export function existingImageFilePath(image) {
  const filePath = imageFilePath(image);
  if (!filePath || !fs.existsSync(filePath)) return null;
  const realRoot = fs.realpathSync(assetRequestUploadRoot);
  const realFile = fs.realpathSync(filePath);
  return realFile.startsWith(`${realRoot}${path.sep}`) ? realFile : null;
}

export function existingAttachmentFilePath(attachment) {
  const filename = path.basename(String(attachment?.filename || ''));
  const allowedFile =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|gif|heic|heif|bmp|pdf|doc|docx|xls|xlsx|txt)$/i;
  if (!filename || filename !== attachment?.filename || !allowedFile.test(filename)) return null;
  const resolved = path.resolve(assetRequestUploadRoot, filename);
  const rootPrefix = `${path.resolve(assetRequestUploadRoot)}${path.sep}`;
  if (!resolved.startsWith(rootPrefix) || !fs.existsSync(resolved)) return null;
  const realRoot = fs.realpathSync(assetRequestUploadRoot);
  const realFile = fs.realpathSync(resolved);
  return realFile.startsWith(`${realRoot}${path.sep}`) ? realFile : null;
}

export function removeImageFile(image) {
  const filePath = imageFilePath(image);
  if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function removeAttachmentFile(attachment) {
  const filePath = existingAttachmentFilePath(attachment);
  if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
