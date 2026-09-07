import fs from 'fs';
import sharp from 'sharp';

/** GPS selfie / standard-image long-edge cap. */
export const GPS_SELFIE_LONG_EDGE = 1280;
/** Preferred palette size (Indexed Color). */
export const GPS_SELFIE_PALETTE_COLORS = 16;
/** Smaller palette when preferred still leaves a large file. */
export const GPS_SELFIE_PALETTE_COLORS_MIN = 8;
export const GPS_SELFIE_WEBP_EFFORT = 4;
/** Skip re-encode when input WebP is already within budget (avoids OOM / timeouts). */
export const WEBP_PASSTHROUGH_MAX_BYTES = 900 * 1024;

const SHARP_OPTS = {
  failOn: 'none',
  animated: false,
  limitInputPixels: 268402689 * 4,
};

function readInputBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  return fs.readFileSync(input);
}

function resultFromBuffer(buffer, info = {}, extras = {}) {
  return {
    buffer,
    contentType: 'image/webp',
    ext: '.webp',
    width: info.width || 0,
    height: info.height || 0,
    pageCount: 1,
    bytesPerPage: buffer.length,
    paletteColors: extras.paletteColors ?? null,
    indexed: extras.indexed !== false,
    encodeMode: extras.encodeMode || 'indexed-webp',
  };
}

/**
 * Light resize-only WebP (lossless when possible). Used when palette path fails
 * or for oversized WebP that only needs a dimension cap.
 */
export async function optimizeWebpResizeOnly(input, opts = {}) {
  const longEdge = opts.longEdge ?? GPS_SELFIE_LONG_EDGE;
  const { data, info } = await sharp(input, SHARP_OPTS)
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
    .toBuffer({ resolveWithObject: true });
  return resultFromBuffer(data, info, {
    indexed: false,
    encodeMode: 'webp-resize',
  });
}

/**
 * Quantize to an 8–16 colour indexed image, then lossless WebP.
 * Already-suitable WebP inputs pass through (or resize-only) to avoid Render OOM
 * from PNG palette round-trips on large/lossless sources.
 *
 * @param {string|Buffer} input
 * @param {{ colours?: number, longEdge?: number }} [opts]
 */
export async function optimizeGpsSelfieToIndexedWebp(input, opts = {}) {
  const longEdge = opts.longEdge ?? GPS_SELFIE_LONG_EDGE;
  const preferred = Math.min(
    GPS_SELFIE_PALETTE_COLORS,
    Math.max(GPS_SELFIE_PALETTE_COLORS_MIN, opts.colours ?? GPS_SELFIE_PALETTE_COLORS),
  );

  let meta;
  try {
    meta = await sharp(input, SHARP_OPTS).metadata();
  } catch {
    meta = null;
  }

  if (meta?.format === 'webp') {
    const maxDim = Math.max(Number(meta.width) || 0, Number(meta.height) || 0);
    const inputBuf = readInputBuffer(input);
    if (
      maxDim > 0
      && maxDim <= longEdge
      && inputBuf.length > 0
      && inputBuf.length <= WEBP_PASSTHROUGH_MAX_BYTES
    ) {
      return resultFromBuffer(inputBuf, meta, {
        indexed: true,
        encodeMode: 'webp-passthrough',
      });
    }
    if (maxDim > longEdge) {
      try {
        return await optimizeWebpResizeOnly(input, { longEdge });
      } catch {
        /* fall through to palette path */
      }
    }
  }

  try {
    const resized = sharp(input, SHARP_OPTS)
      .rotate()
      .resize({
        width: longEdge,
        height: longEdge,
        fit: 'inside',
        withoutEnlargement: true,
      });

    // Materialize once so we can try 16 then 8 colours without re-decoding source
    const basePng = await resized.png({ compressionLevel: 3, force: true }).toBuffer();

    async function encodeWithPalette(colours) {
      const indexedPng = await sharp(basePng)
        .png({
          palette: true,
          colours,
          effort: 5,
          dither: 1.0,
        })
        .toBuffer();

      const { data, info } = await sharp(indexedPng)
        .webp({
          lossless: true,
          effort: GPS_SELFIE_WEBP_EFFORT,
        })
        .toBuffer({ resolveWithObject: true });

      return resultFromBuffer(data, info, {
        paletteColors: colours,
        indexed: true,
        encodeMode: 'indexed-webp',
      });
    }

    let best = await encodeWithPalette(preferred);
    if (
      preferred > GPS_SELFIE_PALETTE_COLORS_MIN
      && best.buffer.length > 350 * 1024
    ) {
      const tighter = await encodeWithPalette(GPS_SELFIE_PALETTE_COLORS_MIN);
      if (tighter.buffer.length < best.buffer.length) best = tighter;
    }
    return best;
  } catch (err) {
    console.warn(
      `[media] indexed WebP encode failed (${err?.message || err}); using resize-only WebP`,
    );
    return optimizeWebpResizeOnly(input, { longEdge });
  }
}

/**
 * Optimize a GPS selfie file on disk → indexed-color WebP (or passthrough).
 * @param {string} absPath
 * @param {{ lightOnly?: boolean }} [opts]
 */
export async function optimizeGpsSelfieFile(absPath, opts = {}) {
  const before = fs.statSync(absPath).size;
  const result = opts.lightOnly
    ? await optimizeWebpResizeOnly(absPath)
    : await optimizeGpsSelfieToIndexedWebp(absPath);
  return {
    ...result,
    kind: 'image',
    reductionRatio: before > 0 ? result.buffer.length / before : null,
    originalBytes: before,
  };
}
