import sharp from 'sharp';

export const IMAGE_MAX_LONG_EDGE = 2500;
export const WEBP_QUALITY = 90;

/**
 * Normalize → strip metadata → resize max long edge → WebP Q90.
 * @param {string} absPath
 * @returns {Promise<{ buffer: Buffer, contentType: string, ext: string, width: number, height: number }>}
 */
export async function optimizeImageToWebp(absPath) {
  const pipeline = sharp(absPath, { failOn: 'none', animated: false })
    .rotate() // honor EXIF orientation, then strip
    .resize({
      width: IMAGE_MAX_LONG_EDGE,
      height: IMAGE_MAX_LONG_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY, effort: 4 });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    contentType: 'image/webp',
    ext: '.webp',
    width: info.width || 0,
    height: info.height || 0,
  };
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
