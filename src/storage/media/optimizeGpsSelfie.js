import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  SHARP_LIMIT_INPUT_PIXELS,
  STANDARD_IMAGE_LONG_EDGE,
  WEBP_PASSTHROUGH_MAX_BYTES,
  assertPixelBudget,
} from './uploadLimits.js';
import { logMemory } from '../../utils/memory.js';

/** @deprecated use STANDARD_IMAGE_LONG_EDGE */
export const GPS_SELFIE_LONG_EDGE = STANDARD_IMAGE_LONG_EDGE;
export const GPS_SELFIE_PALETTE_COLORS = 16;
export const GPS_SELFIE_PALETTE_COLORS_MIN = 8;
export const GPS_SELFIE_WEBP_EFFORT = 4;
export { WEBP_PASSTHROUGH_MAX_BYTES };

const SHARP_OPTS = {
  failOn: 'none',
  animated: false,
  limitInputPixels: SHARP_LIMIT_INPUT_PIXELS,
};

function resultFromFile(absPath, info = {}, extras = {}) {
  const size = fs.statSync(absPath).size;
  return {
    /** Prefer filePath so callers avoid holding a second Buffer copy. */
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

/** Ensure callers that still expect `.buffer` get one (prefer filePath when possible). */
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

/**
 * Light resize-only lossless WebP written to a temp file (no multi-buffer PNG round-trip).
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
      effort: Math.min(4, GPS_SELFIE_WEBP_EFFORT),
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
 * Quantize to 8–16 colour indexed image, then lossless WebP — file intermediates only.
 * Already-suitable WebP inputs pass through (copy) without decode/re-encode.
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

  if (meta.format === 'webp' && typeof input === 'string' && fs.existsSync(input)) {
    const maxDim = Math.max(Number(meta.width) || 0, Number(meta.height) || 0);
    const size = fs.statSync(input).size;
    if (
      maxDim > 0
      && maxDim <= longEdge
      && size > 0
      && size <= WEBP_PASSTHROUGH_MAX_BYTES
    ) {
      logMemory('optimize:webp-passthrough', { bytes: size, width: meta.width, height: meta.height });
      fs.copyFileSync(input, outPath);
      return resultFromFile(outPath, meta, {
        indexed: true,
        encodeMode: 'webp-passthrough',
      });
    }
    if (maxDim > longEdge) {
      try {
        return await optimizeWebpResizeOnly(input, { longEdge, outPath });
      } catch {
        /* fall through */
      }
    }
  }

  // Buffer input that is already small WebP — write once then passthrough path
  if (meta.format === 'webp' && Buffer.isBuffer(input)) {
    const maxDim = Math.max(Number(meta.width) || 0, Number(meta.height) || 0);
    if (
      maxDim > 0
      && maxDim <= longEdge
      && input.length > 0
      && input.length <= WEBP_PASSTHROUGH_MAX_BYTES
    ) {
      fs.writeFileSync(outPath, input);
      return resultFromFile(outPath, meta, {
        indexed: true,
        encodeMode: 'webp-passthrough',
      });
    }
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-idx-'));
  const resizedPng = path.join(workDir, 'resized.png');
  const indexedPng = path.join(workDir, 'indexed.png');

  try {
    logMemory('optimize:indexed:start', { preferred });
    await sharp(input, SHARP_OPTS)
      .rotate()
      .resize({
        width: longEdge,
        height: longEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 3, force: true })
      .toFile(resizedPng);

    async function encodeWithPalette(colours) {
      await sharp(resizedPng, SHARP_OPTS)
        .png({
          palette: true,
          colours,
          effort: 5,
          dither: 1.0,
        })
        .toFile(indexedPng);

      const candidate = path.join(workDir, `out-${colours}.webp`);
      await sharp(indexedPng, SHARP_OPTS)
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

    let best = await encodeWithPalette(preferred);
    if (preferred > GPS_SELFIE_PALETTE_COLORS_MIN && best.size > 350 * 1024) {
      const tighter = await encodeWithPalette(GPS_SELFIE_PALETTE_COLORS_MIN);
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
