import fs from 'fs';
import sharp from 'sharp';

/** GPS selfie long-edge cap (identity / location photo, not A4 scan). */
export const GPS_SELFIE_LONG_EDGE = 1280;
/** Preferred palette size (Indexed Color). */
export const GPS_SELFIE_PALETTE_COLORS = 16;
/** Smaller palette when preferred still leaves a large file. */
export const GPS_SELFIE_PALETTE_COLORS_MIN = 8;
export const GPS_SELFIE_WEBP_EFFORT = 6;

const SHARP_OPTS = {
  failOn: 'none',
  animated: false,
  limitInputPixels: 268402689 * 4,
};

/**
 * Quantize to an 8–16 colour indexed image, then lossless WebP
 * (WebP colour-indexing transform; not grayscale L / not lossy Q45).
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

  const resized = sharp(input, SHARP_OPTS)
    .rotate()
    .resize({
      width: longEdge,
      height: longEdge,
      fit: 'inside',
      withoutEnlargement: true,
    });

  // Materialize once so we can try 16 then 8 colours without re-decoding source
  const basePng = await resized.png({ compressionLevel: 3 }).toBuffer();

  async function encodeWithPalette(colours) {
    const indexedPng = await sharp(basePng)
      .png({
        palette: true,
        colours,
        effort: 7,
        dither: 1.0,
      })
      .toBuffer();

    const { data, info } = await sharp(indexedPng)
      .webp({
        lossless: true,
        effort: GPS_SELFIE_WEBP_EFFORT,
      })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      contentType: 'image/webp',
      ext: '.webp',
      width: info.width || 0,
      height: info.height || 0,
      pageCount: 1,
      bytesPerPage: data.length,
      paletteColors: colours,
      indexed: true,
      encodeMode: 'indexed-webp',
    };
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
}

/**
 * Optimize a GPS selfie file on disk → indexed-color WebP.
 * @param {string} absPath
 */
export async function optimizeGpsSelfieFile(absPath) {
  const before = fs.statSync(absPath).size;
  const result = await optimizeGpsSelfieToIndexedWebp(absPath);
  return {
    ...result,
    kind: 'image',
    reductionRatio: before > 0 ? result.buffer.length / before : null,
    originalBytes: before,
  };
}
