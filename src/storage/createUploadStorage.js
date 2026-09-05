import fs from 'fs';
import multer from 'multer';
import { persistLocalUploadToR2 } from './persistUpload.js';
import { multerStoredUploadFileName } from './uploadKeys.js';

/**
 * Multer storage: disk (same as multer.diskStorage) + optional R2 mirror.
 * Defaults to the shared stored-file naming convention when `filename` is omitted.
 *
 * @param {{
 *   destination: import('multer').DiskStorageOptions['destination'],
 *   filename?: import('multer').DiskStorageOptions['filename'],
 *   skipR2?: boolean,
 * }} options
 */
export function createUploadStorage({
  destination,
  filename = multerStoredUploadFileName,
  skipR2 = false,
} = {}) {
  const disk = multer.diskStorage({ destination, filename });

  return {
    _handleFile(req, file, cb) {
      disk._handleFile(req, file, (err, info) => {
        if (err) return cb(err);
        if (skipR2 || !info?.path) return cb(null, info);
        persistLocalUploadToR2(info.path, { contentType: file.mimetype })
          .then((result) => {
            if (result?.key) {
              console.log(`[storage] R2 put ok key=${result.key}`);
            }
            cb(null, info);
          })
          .catch((persistErr) => {
            console.error(
              `[storage] R2 put failed path=${info.path}: ${persistErr?.message || persistErr}`,
            );
            try {
              if (info.path && fs.existsSync(info.path)) fs.unlinkSync(info.path);
            } catch {
              /* ignore */
            }
            cb(persistErr);
          });
      });
    },
    _removeFile(req, file, cb) {
      disk._removeFile(req, file, cb);
    },
  };
}
