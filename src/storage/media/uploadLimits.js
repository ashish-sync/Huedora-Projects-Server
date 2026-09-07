/**
 * Upload / image processing limits for Render ~512MB hosts.
 */

/** Max bytes accepted for Camp One execution documents (pre-process). */
export const EXEC_DOC_MAX_BYTES = 10 * 1024 * 1024;

/** Hard pixel budget before Sharp decode (width * height). ~12MP keeps RSS manageable. */
export const MAX_INPUT_PIXELS = 12_000_000;

/** Sharp limitInputPixels — reject larger sources early. */
export const SHARP_LIMIT_INPUT_PIXELS = MAX_INPUT_PIXELS;

/** Long-edge cap for standard / GPS selfie images. */
export const STANDARD_IMAGE_LONG_EDGE = 1280;

/** Already-suitable WebP may skip re-encode under this size. */
export const WEBP_PASSTHROUGH_MAX_BYTES = 900 * 1024;

/** Only one Sharp/image job at a time process-wide. */
export const IMAGE_PROCESS_CONCURRENCY = 1;

/** Max files per execution-document request (serial processing). */
export const EXEC_DOC_MAX_FILES_PER_REQUEST = 3;

export function assertUploadByteLimit(sizeBytes, maxBytes = EXEC_DOC_MAX_BYTES) {
  const size = Number(sizeBytes) || 0;
  if (size <= 0) {
    const err = new Error('Empty file is not allowed');
    err.code = 'UPLOAD_EMPTY';
    err.status = 400;
    throw err;
  }
  if (size > maxBytes) {
    const err = new Error(
      `File is too large (${Math.ceil(size / (1024 * 1024))} MB). Max is ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
    );
    err.code = 'UPLOAD_TOO_LARGE';
    err.status = 413;
    throw err;
  }
}

export function assertPixelBudget(width, height, maxPixels = MAX_INPUT_PIXELS) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w <= 0 || h <= 0) return;
  const pixels = w * h;
  if (pixels > maxPixels) {
    const err = new Error(
      `Image resolution is too high (${w}×${h}). Resize under ~${Math.floor(Math.sqrt(maxPixels))}px on the long edge and retry.`,
    );
    err.code = 'UPLOAD_TOO_MANY_PIXELS';
    err.status = 413;
    throw err;
  }
}
