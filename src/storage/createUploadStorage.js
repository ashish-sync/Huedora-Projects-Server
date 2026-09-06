import fs from 'fs';
import multer from 'multer';
import { multerStoredUploadFileName } from './uploadKeys.js';

/**
 * Multer storage: local disk only.
 * R2 + media optimize run later via finalizeRequestUploads() after the route
 * accepts the upload — avoids orphan objects when validation fails.
 *
 * Import temps: pass skipR2: true (same disk-only behavior; no finalize needed).
 */
export function createUploadStorage({
  destination,
  filename = multerStoredUploadFileName,
  skipR2 = false,
  skipMediaPipeline = false,
} = {}) {
  const disk = multer.diskStorage({ destination, filename });
  // skipR2 / skipMediaPipeline retained for call-site compatibility; both mean disk-only.
  void skipR2;
  void skipMediaPipeline;

  return {
    _handleFile(req, file, cb) {
      disk._handleFile(req, file, (err, info) => {
        if (err) return cb(err);
        if (info) {
          info.mediaFinalized = false;
          info.persistDeferred = true;
        }
        cb(null, info);
      });
    },
    _removeFile(req, file, cb) {
      disk._removeFile(req, file, cb);
    },
  };
}
