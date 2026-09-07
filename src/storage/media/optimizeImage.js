import sharp from 'sharp';
import {
  optimizeGpsSelfieToIndexedWebp,
  GPS_SELFIE_LONG_EDGE,
  GPS_SELFIE_PALETTE_COLORS,
  GPS_SELFIE_PALETTE_COLORS_MIN,
  GPS_SELFIE_WEBP_EFFORT,
} from './optimizeGpsSelfie.js';

/**
 * Standard image master for all uploads except Camp One DF/PF/Other scans:
 * indexed-color (8–16) full-color lossless WebP @ long edge 1280 — same as GPS Selfie.
 */
export const IMAGE_MAX_LONG_EDGE = GPS_SELFIE_LONG_EDGE;
export const STANDARD_IMAGE_PALETTE_COLORS = GPS_SELFIE_PALETTE_COLORS;
export const STANDARD_IMAGE_PALETTE_COLORS_MIN = GPS_SELFIE_PALETTE_COLORS_MIN;
export const STANDARD_IMAGE_WEBP_EFFORT = GPS_SELFIE_WEBP_EFFORT;
/** @deprecated Lossy Q90 is no longer the standard master encode; kept for preview only. */
export const WEBP_QUALITY = 90;

/**
 * Normalize → strip metadata → resize → indexed full-color lossless WebP.
 * Same rule as Camp One GPS Selfie (not grayscale L / not lossy Q45).
 *
 * @param {string|Buffer} input abs path or buffer
 * @param {{ colours?: number, longEdge?: number }} [opts]
 */
export async function optimizeImageToWebp(input, opts = {}) {
  return optimizeGpsSelfieToIndexedWebp(input, opts);
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
    const { materializeOptimizeResult } = await import('./optimizeGpsSelfie.js');
    const result = await materializeOptimizeResult(await optimizeGpsSelfieToIndexedWebp(input));
    return `data:image/webp;base64,${result.buffer.toString('base64')}`;
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
