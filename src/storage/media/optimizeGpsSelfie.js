import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  SHARP_LIMIT_INPUT_PIXELS,
  STANDARD_IMAGE_LONG_EDGE,
  WEBP_PASSTHROUGH_MAX_BYTES,
  assertPixelBudget,
  isPassthroughWebpMeta,
} from './uploadLimits.js';
import { logMemory } from '../../utils/memory.js';
import { configureSharpForLowMemory } from './sharpConfig.js';

configureSharpForLowMemory();

/** @deprecated use STANDARD_IMAGE_LONG_EDGE */
export const GPS_SELFIE_LONG_EDGE = STANDARD_IMAGE_LONG_EDGE;
export const GPS_SELFIE_PALETTE_COLORS = 16;
export const GPS_SELFIE_PALETTE_COLORS_MIN = 8;
export const GPS_SELFIE_WEBP_EFFORT = 2;
export { WEBP_PASSTHROUGH_MAX_BYTES };

const SHARP_OPTS = {
  failOn: 'none',
  animated: false,
  limitInputPixels: SHARP_LIMIT_INPUT_PIXELS,
  sequentialRead: true,
};

function resultFromFile(absPath, info = {}, extras = {}) {
  const size = fs.statSync(absPath).size;
  return {
    filePath: absPath,
    buffer: null,
    contentType: 'image/webp',
    ext: '.webp',
    width: info.width || 0,
    height: info.height || 0,
    pageCount: 1,
    bytesPerPage: size,
    paletteColors: extras.paletteColors ?? null,
    indexed: extras.indexed !== false,
    encodeMode: extras.encodeMode || 'indexed-webp',
  };
}

async function readResultBuffer(result) {
  if (Buffer.isBuffer(result.buffer) && result.buffer.length) return result.buffer;
  if (result.filePath && fs.existsSync(result.filePath)) {
    return fs.readFileSync(result.filePath);
  }
  throw new Error('Optimized image result missing bytes');
}

export async function materializeOptimizeResult(result) {
  if (Buffer.isBuffer(result?.buffer) && result.buffer.length) return result;
  const buffer = await readResultBuffer(result);
  return { ...result, buffer, bytesPerPage: buffer.length };
}

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
 * Light resize-only lossless WebP written to a temp file (no palette PNG round-trip).
 */
export async function optimizeWebpResizeOnly(input, opts = {}) {
  const longEdge = opts.longEdge ?? GPS_SELFIE_LONG_EDGE;
  const outPath = opts.outPath || tmpWebpPath('resize');
  logMemory('optimize:webp-resize:start');
  const meta = await sharp(input, SHARP_OPTS).metadata();
  assertPixelBudget(meta.width, meta.height);
  await sharp(input, SHARP_OPTS)
    .rotate()
    .resize({
      width: longEdge,
      height: longEdge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({
      lossless: true,
      effort: Math.min(2, GPS_SELFIE_WEBP_EFFORT),
    })
    .toFile(outPath);
  const info = await sharp(outPath, SHARP_OPTS).metadata();
  logMemory('optimize:webp-resize:done', { bytes: fs.statSync(outPath).size });
  return resultFromFile(outPath, info, {
    indexed: false,
    encodeMode: 'webp-resize',
  });
}

/**
 * Quantize JPEG/PNG → 8–16 colour indexed lossless WebP.
 * WebP inputs are NEVER decoded into the palette path (passthrough or resize-only).
 *
 * @param {string|Buffer} input path preferred
 * @param {{ colours?: number, longEdge?: number, outPath?: string }} [opts]
 */
export async function optimizeGpsSelfieToIndexedWebp(input, opts = {}) {
  const longEdge = opts.longEdge ?? GPS_SELFIE_LONG_EDGE;
  const preferred = Math.min(
    GPS_SELFIE_PALETTE_COLORS,
    Math.max(GPS_SELFIE_PALETTE_COLORS_MIN, opts.colours ?? GPS_SELFIE_PALETTE_COLORS),
  );
  const outPath = opts.outPath || tmpWebpPath('indexed');
  const sizeBytes = inputByteLength(input);

  let meta;
  try {
    meta = await sharp(input, SHARP_OPTS).metadata();
  } catch (err) {
    const e = new Error(`Could not read image metadata: ${err?.message || err}`);
    e.code = 'UPLOAD_OPTIMIZE_FAILED';
    e.status = 400;
    throw e;
  }
  assertPixelBudget(meta.width, meta.height);

  // --- WebP: never run PNG palette decode/re-encode (Render OOM root cause) ---
  if (meta.format === 'webp') {
    if (isPassthroughWebpMeta(meta, sizeBytes, longEdge)) {
      logMemory('optimize:webp-passthrough', {
        bytes: sizeBytes,
        width: meta.width,
        height: meta.height,
      });
      if (typeof input === 'string') {
        fs.copyFileSync(input, outPath);
      } else {
        fs.writeFileSync(outPath, input);
      }
      return resultFromFile(outPath, meta, {
        indexed: true,
        encodeMode: 'webp-passthrough',
      });
    }
    // Oversized dimensions only — cheap resize, still no palette path.
    logMemory('optimize:webp-oversized-resize', {
      width: meta.width,
      height: meta.height,
      bytes: sizeBytes,
    });
    return optimizeWebpResizeOnly(input, { longEdge, outPath });
  }

  // --- JPEG/PNG/etc → indexed lossless WebP (single palette pass, file intermediates) ---
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-idx-'));
  const indexedPng = path.join(workDir, 'indexed.png');

  try {
    logMemory('optimize:indexed:start', { preferred });
    // One pipeline: resize → palette PNG (skip full-color PNG materialization).
    await sharp(input, SHARP_OPTS)
      .rotate()
      .resize({
        width: longEdge,
        height: longEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({
        palette: true,
        colours: preferred,
        effort: 4,
        dither: 1.0,
        compressionLevel: 3,
      })
      .toFile(indexedPng);

    async function webpFromIndexed(colours, srcPng) {
      const candidate = path.join(workDir, `out-${colours}.webp`);
      await sharp(srcPng, SHARP_OPTS)
        .webp({
          lossless: true,
          effort: GPS_SELFIE_WEBP_EFFORT,
        })
        .toFile(candidate);
      const info = await sharp(candidate, SHARP_OPTS).metadata();
      return {
        path: candidate,
        info,
        colours,
        size: fs.statSync(candidate).size,
      };
    }

    let best = await webpFromIndexed(preferred, indexedPng);

    if (preferred > GPS_SELFIE_PALETTE_COLORS_MIN && best.size > 350 * 1024) {
      const tighterPng = path.join(workDir, 'indexed-8.png');
      await sharp(indexedPng, SHARP_OPTS)
        .png({
          palette: true,
          colours: GPS_SELFIE_PALETTE_COLORS_MIN,
          effort: 4,
          dither: 1.0,
          compressionLevel: 3,
        })
        .toFile(tighterPng);
      const tighter = await webpFromIndexed(GPS_SELFIE_PALETTE_COLORS_MIN, tighterPng);
      if (tighter.size < best.size) {
        try {
          fs.unlinkSync(best.path);
        } catch {
          /* ignore */
        }
        best = tighter;
      } else {
        try {
          fs.unlinkSync(tighter.path);
        } catch {
          /* ignore */
        }
      }
    }

    fs.copyFileSync(best.path, outPath);
    logMemory('optimize:indexed:done', { bytes: best.size, colours: best.colours });
    return resultFromFile(outPath, best.info, {
      paletteColors: best.colours,
      indexed: true,
      encodeMode: 'indexed-webp',
    });
  } catch (err) {
    console.warn(
      `[media] indexed WebP encode failed (${err?.message || err}); using resize-only WebP`,
    );
    return optimizeWebpResizeOnly(input, { longEdge, outPath });
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Optimize a GPS selfie file on disk → indexed-color WebP (or passthrough).
 * @param {string} absPath
 * @param {{ lightOnly?: boolean, outPath?: string }} [opts]
 */
export async function optimizeGpsSelfieFile(absPath, opts = {}) {
  const before = fs.statSync(absPath).size;
  const outPath = opts.outPath || tmpWebpPath('gs');
  const result = opts.lightOnly
    ? await optimizeWebpResizeOnly(absPath, { outPath })
    : await optimizeGpsSelfieToIndexedWebp(absPath, { outPath });
  const after = result.filePath && fs.existsSync(result.filePath)
    ? fs.statSync(result.filePath).size
    : (result.buffer?.length || 0);
  return {
    ...result,
    kind: 'image',
    reductionRatio: before > 0 ? after / before : null,
    originalBytes: before,
  };
}
