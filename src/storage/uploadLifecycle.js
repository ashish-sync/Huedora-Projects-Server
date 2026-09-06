import fs from 'fs';
import { collectUploadedFiles } from '../utils/rejectUnsafeUpload.js';
import {
  applyProcessResultToMulterInfo,
  processUploadedMedia,
} from './media/processUpload.js';
import { deleteLocalUpload } from './persistUpload.js';
import { toUploadObjectKey } from './uploadKeys.js';

/**
 * Optimize + register + R2 for every multer file on the request that is not yet finalized.
 * Call after business validation succeeds, before building the response.
 */
export async function finalizeRequestUploads(req) {
  const files = collectUploadedFiles(req);
  for (const file of files) {
    if (!file?.path || file.mediaFinalized) continue;
    if (!fs.existsSync(file.path)) continue;
    const result = await processUploadedMedia(file.path, {
      originalName: file.originalname,
      mimetype: file.mimetype,
    });
    applyProcessResultToMulterInfo(file, result);
    file.mediaFinalized = true;
    file.persistDeferred = false;
  }
  return files;
}

/**
 * Delete local (+ R2 if present) for request uploads.
 * @param {{ force?: boolean }} [opts] force=true removes even after finalize (error-after-commit).
 */
export async function discardRequestUploads(req, { force = false } = {}) {
  const files = collectUploadedFiles(req);
  for (const file of files) {
    if (!file) continue;
    if (file.mediaFinalized && !force && !file.discardEvenIfFinalized) continue;
    const target = file.path || file.objectKey;
    if (!target) continue;
    try {
      await deleteLocalUpload(target);
    } catch (err) {
      console.warn(
        `[storage] discard failed key=${toUploadObjectKey(target) || target}: ${err?.message || err}`,
      );
    }
    file.discarded = true;
  }
}

/**
 * Middleware: commit uploads when the response is successful; discard on 4xx/5xx.
 * Prefer explicit finalizeRequestUploads() when filenames must change before res.json
 * (e.g. camp execution semantic rename) — this is a safety net for other routes.
 */
export function ensureUploadCommit() {
  return (req, res, next) => {
    if (!collectUploadedFiles(req).length) return next();

    const sendJson = res.json.bind(res);
    let settled = false;

    res.json = (body) => {
      if (settled) return sendJson(body);
      settled = true;
      const status = res.statusCode || 200;
      if (status >= 400) {
        discardRequestUploads(req)
          .catch(() => {})
          .finally(() => sendJson(body));
        return res;
      }
      finalizeRequestUploads(req)
        .then(() => sendJson(body))
        .catch((err) => {
          console.error(`[storage] finalize failed: ${err?.message || err}`);
          discardRequestUploads(req)
            .catch(() => {})
            .finally(() => {
              if (!res.headersSent) {
                res.status(500);
                sendJson({
                  error: {
                    code: 'UPLOAD_PERSIST_FAILED',
                    message: 'The file could not be saved. Please try again.',
                    requestId: req.requestId,
                  },
                });
              }
            });
        });
      return res;
    };

    next();
  };
}
