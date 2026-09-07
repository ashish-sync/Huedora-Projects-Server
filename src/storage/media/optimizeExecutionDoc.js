import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { classifyUploadKind } from './mediaKinds.js';

import {
  SHARP_LIMIT_INPUT_PIXELS,
  assertPixelBudget,
} from './uploadLimits.js';
import { logMemory } from '../../utils/memory.js';

/** Long-edge target for ~150–200 DPI A4 field scans */
export const EXEC_DOC_LONG_EDGE = 1700;
/** Lossy WebP / JPEG quality (Pillow-script equivalent: quality=45). */
export const EXEC_DOC_WEBP_QUALITY = 45;
export const EXEC_DOC_JPEG_QUALITY = 45;
export const EXEC_DOC_WEBP_EFFORT = 6;
/** Soft footprint band (logged; not a hard fail). Clarity of stamps/ink still wins over size. */
export const EXEC_DOC_TARGET_KB_MIN = 150;
export const EXEC_DOC_TARGET_KB_MAX = 300;
export const EXEC_DOC_TARGET_KB_PREFERRED_MIN = 250;
export const EXEC_DOC_TARGET_KB_PREFERRED_MAX = 300;

const SHARP_OPTS = {
  failOn: 'none',
  animated: false,
  limitInputPixels: SHARP_LIMIT_INPUT_PIXELS,
};

/**
 * Blue-stamp friendly scan prep → 8-bit single-channel grayscale (Pillow mode "L" / b-w).
 * Red-weighted recomb so cyan/blue stamps go dark; mild levels for paper/ink separation.
 */
export function buildExecutionScanPipeline(input, { longEdge = EXEC_DOC_LONG_EDGE, sharpInput = {} } = {}) {
  return sharp(input, { ...SHARP_OPTS, ...sharpInput })
    .rotate() // EXIF orientation; metadata stripped on encode
    .removeAlpha()
    .recomb([
      [0.92, 0.04, 0.04],
      [0.92, 0.04, 0.04],
      [0.92, 0.04, 0.04],
    ])
    .greyscale()
    .normalize({ lower: 2, upper: 98 })
    .resize({
      width: longEdge,
      height: longEdge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    // Force 8-bit single-channel output (not 3× identical sRGB)
    .toColourspace('b-w');
}

/**
 * Render scan to raw 8-bit L (1 channel) — never a color PNG intermediate.
 * @returns {Promise<{ data: Buffer, width: number, height: number, channels: number }>}
 */
export async function prepareScanPageL(input, opts = {}) {
  if (typeof input === 'string') {
    const meta = await sharp(input, SHARP_OPTS).metadata();
    assertPixelBudget(meta.width, meta.height);
  }
  const { data, info } = await buildExecutionScanPipeline(input, {
    sharpInput: opts.sharpInput,
  })
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 1) {
    throw new Error(`Expected 8-bit single-channel grayscale, got channels=${info.channels}`);
  }
  return {
    data,
    width: info.width || 0,
    height: info.height || 0,
    channels: 1,
  };
}

function sharpFromL(page) {
  return sharp(page.data, {
    raw: {
      width: page.width,
      height: page.height,
      channels: 1,
    },
  }).toColourspace('b-w');
}

/**
 * Encode 8-bit L page as lossy grayscale WebP @ quality 45.
 */
export async function encodeLToWebp(page, { quality = EXEC_DOC_WEBP_QUALITY } = {}) {
  const { data, info } = await sharpFromL(page)
    .webp({
      quality,
      effort: EXEC_DOC_WEBP_EFFORT,
      smartSubsample: true,
      lossless: false,
    })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, info, quality };
}

/**
 * Encode 8-bit L page as grayscale JPEG @ quality 45 (for PDF embedding).
 */
export async function encodeLToJpeg(page, { quality = EXEC_DOC_JPEG_QUALITY } = {}) {
  const { data, info } = await sharpFromL(page)
    .jpeg({
      quality,
      mozjpeg: true,
      chromaSubsampling: '4:0:0',
    })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, info, quality };
}

/**
 * Field photo / scan → 8-bit L grayscale lossy WebP Q45. Strips EXIF/GPS/thumbs.
 * @param {string|Buffer} input
 * @param {{ sharpInput?: object }} [opts]
 */
export async function optimizeExecutionDocImage(input, opts = {}) {
  logMemory('exec-doc:image:start');
  const page = await prepareScanPageL(input, opts);
  try {
    const encoded = await encodeLToWebp(page);
    return {
      buffer: encoded.buffer,
      contentType: 'image/webp',
      ext: '.webp',
      width: encoded.info.width || page.width,
      height: encoded.info.height || page.height,
      channels: 1,
      pageCount: 1,
      bytesPerPage: encoded.buffer.length,
      encodeQuality: encoded.quality,
    };
  } finally {
    page.data = null;
    logMemory('exec-doc:image:done');
  }
}

/**
 * Encode one 8-bit L page as grayscale JPEG for PDF embedding.
 * @param {string|Buffer} input
 * @param {{ sharpInput?: object }} [opts]
 */
export async function optimizeExecutionDocPageJpeg(input, opts = {}) {
  const page = await prepareScanPageL(input, opts);
  const encoded = await encodeLToJpeg(page);
  return {
    buffer: encoded.buffer,
    width: encoded.info.width || page.width,
    height: encoded.info.height || page.height,
    encodeQuality: encoded.quality,
  };
}

async function rasterizePdfPages(absPath) {
  // One page at a time — do not accumulate raw L buffers across pages.
  const pages = [];
  let page = 0;
  for (;;) {
    try {
      logMemory('exec-doc:pdf-page', { page });
      const jpeg = await optimizeExecutionDocPageJpeg(absPath, {
        sharpInput: { density: 175, page },
      });
      pages.push(jpeg);
      page += 1;
      if (page > 40) break;
    } catch (err) {
      if (page === 0) throw err;
      break;
    }
  }
  return pages;
}

/**
 * Multi-page PDF → grayscale JPEG-in-PDF (Q45), metadata stripped via rewrite.
 * Falls back to null when PDF rasterization is unavailable on the host.
 * @param {string} absPath
 */
export async function optimizeExecutionDocPdf(absPath) {
  let pages;
  try {
    pages = await rasterizePdfPages(absPath);
  } catch (err) {
    console.warn(
      `[media:exec-doc] PDF rasterize unavailable (${err?.message || err}); keeping PDF lightly optimized`,
    );
    return null;
  }
  if (!pages.length) return null;

  const outPdf = await PDFDocument.create();
  outPdf.setTitle('');
  outPdf.setAuthor('');
  outPdf.setSubject('');
  outPdf.setKeywords([]);
  outPdf.setProducer('TYLO One');
  outPdf.setCreator('TYLO One');

  let totalBytes = 0;
  const dims = { width: pages[0]?.width || 0, height: pages[0]?.height || 0, pageCount: pages.length };
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    const embedded = await outPdf.embedJpg(page.buffer);
    const w = embedded.width;
    const h = embedded.height;
    const pdfPage = outPdf.addPage([w, h]);
    pdfPage.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
    totalBytes += page.buffer.length;
    // Drop JPEG bytes immediately after embed to limit peak RSS.
    page.buffer = null;
    pages[i] = null;
  }

  const buffer = Buffer.from(
    await outPdf.save({ useObjectStreams: true, addDefaultPage: false }),
  );
  logMemory('exec-doc:pdf:done', { pages: dims.pageCount, bytes: buffer.length });
  return {
    buffer,
    contentType: 'application/pdf',
    ext: '.pdf',
    width: dims.width,
    height: dims.height,
    pageCount: dims.pageCount,
    bytesPerPage: Math.round(buffer.length / dims.pageCount),
    jpegBytesTotal: totalBytes,
  };
}

/**
 * Optimize one execution-document file on disk.
 * GPS selfies use optimizeGpsSelfie.js (indexed-color WebP) — caller routes separately.
 *
 * @param {string} absPath
 * @param {{ originalName?: string, mimetype?: string }} [opts]
 */
export async function optimizeExecutionDocumentFile(absPath, opts = {}) {
  const originalName = opts.originalName || path.basename(absPath);
  const mimetype = opts.mimetype || '';
  const kind = classifyUploadKind({ originalName, mimetype });
  const before = fs.statSync(absPath).size;

  if (kind === 'image') {
    const result = await optimizeExecutionDocImage(absPath);
    return {
      ...result,
      kind: 'image',
      reductionRatio: before > 0 ? result.buffer.length / before : null,
      originalBytes: before,
    };
  }

  if (kind === 'pdf') {
    const raster = await optimizeExecutionDocPdf(absPath);
    if (raster) {
      return {
        ...raster,
        kind: 'pdf',
        reductionRatio: before > 0 ? raster.buffer.length / before : null,
        originalBytes: before,
      };
    }
    return null;
  }

  return null;
}

export function footprintBandLabel(bytesPerPage) {
  const kb = (Number(bytesPerPage) || 0) / 1024;
  if (kb >= EXEC_DOC_TARGET_KB_PREFERRED_MIN && kb <= EXEC_DOC_TARGET_KB_PREFERRED_MAX) {
    return 'preferred';
  }
  if (kb >= EXEC_DOC_TARGET_KB_MIN && kb <= EXEC_DOC_TARGET_KB_MAX) {
    return 'in-band';
  }
  if (kb < EXEC_DOC_TARGET_KB_MIN) return 'below-band';
  return 'above-band';
}

export function logExecutionDocFootprint(label, result) {
  const size = Number(result?.bytesPerPage)
    || (Buffer.isBuffer(result?.buffer) ? result.buffer.length : 0)
    || (result?.filePath && fs.existsSync(result.filePath) ? fs.statSync(result.filePath).size : 0);
  if (!size) return;
  const total = Buffer.isBuffer(result?.buffer)
    ? result.buffer.length
    : (result?.filePath && fs.existsSync(result.filePath) ? fs.statSync(result.filePath).size : size);
  const kb = (total / 1024).toFixed(1);
  const perPageBytes = result.bytesPerPage != null ? result.bytesPerPage : size;
  const perPage = (perPageBytes / 1024).toFixed(1);
  const band = footprintBandLabel(perPageBytes);
  const q = result.encodeQuality != null ? ` q=${result.encodeQuality}` : '';
  console.log(
    `[media:exec-doc] ${label} pages=${result.pageCount || 1} total=${kb}KB perPage≈${perPage}KB (${band})${q} L`,
  );
}
