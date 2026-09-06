import fs from 'fs';
import multer from 'multer';
import { multerStoredUploadFileName } from './uploadKeys.js';
import {
  applyProcessResultToMulterInfo,
  processUploadedMedia,
} from './media/processUpload.js';
import { enqueueMediaJob } from './media/mediaQueue.js';

/**
 * Multer storage: disk + media optimize + optional R2 mirror.
 * Defaults to the shared stored-file naming convention when `filename` is omitted.
 *
 * @param {{
 *   destination: import('multer').DiskStorageOptions['destination'],
 *   filename?: import('multer').DiskStorageOptions['filename'],
 *   skipR2?: boolean,
 *   skipMediaPipeline?: boolean,
 * }} options
 */
export function createUploadStorage({
  destination,
  filename = multerStoredUploadFileName,
  skipR2 = false,
  skipMediaPipeline = false,
} = {}) {
  const disk = multer.diskStorage({ destination, filename });

  return {
    _handleFile(req, file, cb) {
      disk._handleFile(req, file, (err, info) => {
        if (err) return cb(err);
        if (!info?.path) return cb(null, info);

        // Ephemeral import temps: keep old behavior (no R2, no optimize).
        if (skipR2 || skipMediaPipeline) {
          return cb(null, info);
        }

        processUploadedMedia(info.path, {
          originalName: file.originalname,
          mimetype: file.mimetype,
        })
          .then((result) => {
            applyProcessResultToMulterInfo(info, result);
            if (result?.objectKey) {
              console.log(
                `[storage] media ready key=${result.objectKey} kind=${result.kind}` +
                  (result.reductionRatio != null
                    ? ` reduction=${(result.reductionRatio * 100).toFixed(0)}%`
                    : ''),
              );
            }
            cb(null, info);
          })
          .catch((persistErr) => {
            console.error(
              `[storage] media process failed path=${info.path}: ${persistErr?.message || persistErr}`,
            );
            // Keep original on disk; mirror raw bytes to R2; enqueue retry
            if (info.path && fs.existsSync(info.path)) {
              import('./persistUpload.js')
                .then(({ persistLocalUploadToR2 }) =>
                  persistLocalUploadToR2(info.path, { contentType: file.mimetype }).catch(() => {}),
                )
                .catch(() => {});
              enqueueMediaJob({
                absPath: info.path,
                originalName: file.originalname,
                mimetype: file.mimetype,
              });
              return cb(null, info);
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
