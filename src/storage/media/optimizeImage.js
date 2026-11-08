import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  SHARP_LIMIT_INPUT_PIXELS,
  STANDARD_IMAGE_LONG_EDGE,
} from './uploadLimits.js';
import { extractExifGps } from './extractExifGps.js';
import { configureSharpForLowMemory } from './sharpConfig.js';

configureSharpForLowMemory();

/** Maximum long edge dimension in pixels per policy */
export const IMAGE_MAX_LONG_EDGE = 2500;

/** Images larger than 1 MB trigger mandatory compression */
export const COMPRESSION_THRESHOLD_BYTES = 1024 * 1024; // 1 MB (1,048,576 bytes)

/** Target compressed file size */
export const TARGET_MAX_BYTES = 500 * 1024; // 500 KB (512,000 bytes)

/** Initial WebP encoding quality */
export const INITIAL_QUALITY = 90;

/** Quality decrement step when targeting <= 500 KB */
export const QUALITY_STEP = 5;

/** Floor quality to preserve facial/document visual clarity */
export const MIN_QUALITY_FLOOR = 70;

/** WebP compression effort (balanced speed & ratio) */
export const WEBP_EFFORT = 3;

// Backward-compatibility exports
export const STANDARD_IMAGE_PALETTE_COLORS = 16;
export const STANDARD_IMAGE_PALETTE_COLORS_MIN = 8;
export const STANDARD_IMAGE_WEBP_EFFORT = WEBP_EFFORT;
export const WEBP_QUALITY = INITIAL_QUALITY;

const SHARP_OPTS = {
  failOn: 'none',
  animated: false,
  limitInputPixels: SHARP_LIMIT_INPUT_PIXELS,
  sequentialRead: true,
};

function tmpWebpPath(tag = 'img') {
  return path.join(
    os.tmpdir(),
    `tylo-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`,
  );
}

function inputByteLength(input) {
  if (Buffer.isBuffer(input)) return input.length;
  if (typeof input === 'string' && fs.existsSync(input)) return fs.statSync(input).size;
  return 0;
}

/**
 * System-wide Image Compression Policy:
 * 1. Target WebP format.
 * 2. Cap maximum long edge at 2,500 px while preserving aspect ratio.
 * 3. Auto-orient using EXIF orientation.
 * 4. Preserve required GPS/location data before stripping EXIF metadata.
 * 5. If image is > 1 MB (1,048,576 bytes):
 *    - Compress to WebP starting at quality 90.
 *    - If size > 500 KB, adaptively step quality down (90 -> 85 -> 80 -> 75 -> 70) targeting <= 500 KB.
 *    - If size cannot reach <= 500 KB without dropping below quality floor (70),
 *      preserve clarity at quality 70 and log an exception.
 * 6. Avoid unnecessary recompression of existing WebP images (if already WebP, <= 1 MB, and long edge <= 2500 px).
 * 7. Do not compress PDFs or non-image documents.
 *
 * @param {string|Buffer} input File path or Buffer
 * @param {{ originalName?: string, outPath?: string, forceCompress?: boolean }} [opts]
 * @returns {Promise<{
 *   filePath?: string,
 *   buffer?: Buffer,
 *   contentType: string,
 *   ext: string,
 *   width: number,
 *   height: number,
 *   sizeBytes: number,
 *   originalSizeBytes: number,
 *   reductionRatio: number|null,
 *   gps: { latitude: number, longitude: number, altitude?: number, timestamp?: string }|null,
 *   quality: number,
 *   clarityPreserved: boolean,
 *   exceptionLogged: boolean,
 *   skipped?: boolean,
 *   reason?: string,
 * }>}
 */
export async function compressImagePolicy(input, opts = {}) {
  const originalSize = inputByteLength(input);
  const inputName = opts.originalName || (typeof input === 'string' ? path.basename(input) : 'buffer');

  let meta;
  try {
    meta = await sharp(input, SHARP_OPTS).metadata();
  } catch (err) {
    console.warn(`[media:compression] Non-image or unreadable format (${inputName}): ${err?.message || err}`);
    return {
      skipped: true,
      reason: 'unreadable-or-non-image',
      originalSizeBytes: originalSize,
      sizeBytes: originalSize,
      contentType: 'application/octet-stream',
    };
  }

  const format = String(meta.format || '').toLowerCase();
  const isImage = ['jpeg', 'jpg', 'png', 'webp', 'tiff', 'tif', 'gif', 'bmp', 'avif', 'heic', 'heif'].includes(format);
  if (!isImage) {
    return {
      skipped: true,
      reason: 'non-image',
      originalSizeBytes: originalSize,
      sizeBytes: originalSize,
      contentType: `image/${format || 'octet-stream'}`,
    };
  }

  // Preserve GPS/location metadata before stripping EXIF
  let gps = null;
  if (meta.exif) {
    gps = extractExifGps(meta.exif);
  }

  const width = meta.width || 0;
  const height = meta.height || 0;
  const maxEdge = Math.max(width, height);

  // Avoid unnecessary recompression of existing WebP images
  const isExistingWebp = format === 'webp';
  const isUnder1Mb = originalSize <= COMPRESSION_THRESHOLD_BYTES;
  const isUnderMaxEdge = maxEdge <= IMAGE_MAX_LONG_EDGE;

  if (isExistingWebp && isUnder1Mb && isUnderMaxEdge && !opts.forceCompress) {
    return {
      skipped: true,
      reason: 'already-compliant-webp',
      filePath: typeof input === 'string' ? input : undefined,
      buffer: Buffer.isBuffer(input) ? input : undefined,
      contentType: 'image/webp',
      ext: '.webp',
      width,
      height,
      sizeBytes: originalSize,
      originalSizeBytes: originalSize,
      reductionRatio: 1,
      gps,
      quality: INITIAL_QUALITY,
      clarityPreserved: false,
      exceptionLogged: false,
    };
  }

  // Determine if downscaling is required
  const needsResize = maxEdge > IMAGE_MAX_LONG_EDGE;

  // Build pipeline: auto-orient via EXIF and resize if long edge > 2500 px
  let pipeline = sharp(input, SHARP_OPTS).rotate();

  if (needsResize) {
    pipeline = pipeline.resize({
      width: IMAGE_MAX_LONG_EDGE,
      height: IMAGE_MAX_LONG_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  // WebP Adaptive Quality Step-Down
  let quality = INITIAL_QUALITY;
  let compressedBuffer = await pipeline.clone().webp({ quality, effort: WEBP_EFFORT }).toBuffer();

  // If larger than 500 KB, step quality down until <= 500 KB or MIN_QUALITY_FLOOR is reached
  while (compressedBuffer.length > TARGET_MAX_BYTES && quality > MIN_QUALITY_FLOOR) {
    quality = Math.max(MIN_QUALITY_FLOOR, quality - QUALITY_STEP);
    compressedBuffer = await pipeline.clone().webp({ quality, effort: WEBP_EFFORT }).toBuffer();
  }

  let clarityPreserved = false;
  let exceptionLogged = false;

  // If at quality floor (70) it still exceeds 500 KB, preserve visual clarity and log exception
  if (compressedBuffer.length > TARGET_MAX_BYTES) {
    clarityPreserved = true;
    exceptionLogged = true;
    console.warn(
      `[media:compression] Image clarity preserved: could not reach 500 KB without unacceptable quality loss. ` +
      `File: "${inputName}", Size: ${(compressedBuffer.length / 1024).toFixed(1)} KB (target <= 500 KB), ` +
      `Quality: ${quality}, Dimensions: ${width}x${height}`,
    );
  }

  // Write output
  const outPath = opts.outPath || tmpWebpPath('policy');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, compressedBuffer);

  const outInfo = await sharp(compressedBuffer, SHARP_OPTS).metadata();
  const finalSize = compressedBuffer.length;

  return {
    filePath: outPath,
    buffer: compressedBuffer,
    contentType: 'image/webp',
    ext: '.webp',
    width: outInfo.width || width,
    height: outInfo.height || height,
    sizeBytes: finalSize,
    originalSizeBytes: originalSize,
    reductionRatio: originalSize > 0 ? Number((finalSize / originalSize).toFixed(4)) : null,
    gps,
    quality,
    clarityPreserved,
    exceptionLogged,
    skipped: false,
  };
}

/**
 * Standard image master for all uploads:
 * WebP @ quality 90 targeting <= 500 KB, max long edge 2500 px.
 *
 * @param {string|Buffer} input abs path or buffer
 * @param {object} [opts]
 */
export async function optimizeImageToWebp(input, opts = {}) {
  return compressImagePolicy(input, opts);
}

/**
 * Optimize a `data:image/...;base64,...` payload (Signature Master, Org logo, etc.).
 * Non-image / invalid data URLs are returned unchanged.
 * @param {string} dataUrl
 * @returns {Promise<string>}
 */
export async function optimizeImageDataUrl(dataUrl) {
  const raw = String(dataUrl || '').trim();
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(raw);
  if (!match) return raw;
  const mime = String(match[1] || '').toLowerCase();
  if (!mime.startsWith('image/')) return raw;
  if (mime.includes('svg')) return raw;

  try {
    const input = Buffer.from(match[2], 'base64');
    if (!input.length) return raw;
    const result = await compressImagePolicy(input);
    const buf = result.buffer || (result.filePath ? fs.readFileSync(result.filePath) : input);
    return `data:image/webp;base64,${buf.toString('base64')}`;
  } catch (err) {
    console.warn(`[media] optimizeImageDataUrl failed: ${err?.message || err}`);
    return raw;
  }
}

/**
 * Generate a disposable preview/thumb WebP from a master image path or buffer.
 * @param {string|Buffer} input
 * @param {{ width?: number }} [opts]
 */
export async function generateImagePreviewWebp(input, { width = 240 } = {}) {
  const w = Math.min(1200, Math.max(48, Number(width) || 240));
  const { data } = await sharp(input, { failOn: 'none', animated: false })
    .rotate()
    .resize({ width: w, withoutEnlargement: true })
    .webp({ quality: 80, effort: 3 })
    .toBuffer({ resolveWithObject: true });
  return data;
}
