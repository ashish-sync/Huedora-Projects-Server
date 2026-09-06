import path from 'path';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff', '.bmp', '.heic', '.heif']);
const PDF_EXT = new Set(['.pdf']);

const IMAGE_MIME = /^(image\/(jpeg|jpg|png|webp|gif|tiff|bmp|heic|heif))$/i;
const PDF_MIME = /^application\/pdf$/i;

/**
 * Classify upload. PDFs are never treated as images (no WebP conversion).
 * @param {{ originalName?: string, mimetype?: string, contentType?: string }} input
 * @returns {'image'|'pdf'|'other'}
 */
export function classifyUploadKind(input = {}) {
  const mime = String(input.mimetype || input.contentType || '')
    .trim()
    .toLowerCase();
  const ext = path.extname(String(input.originalName || input.name || '')).toLowerCase();

  if (PDF_MIME.test(mime) || PDF_EXT.has(ext)) return 'pdf';
  if (IMAGE_MIME.test(mime) || IMAGE_EXT.has(ext)) {
    // Guard: never classify PDF as image even if mislabeled
    if (PDF_EXT.has(ext) || PDF_MIME.test(mime)) return 'pdf';
    return 'image';
  }
  return 'other';
}

export function isImageKind(kind) {
  return kind === 'image';
}

export function isPdfKind(kind) {
  return kind === 'pdf';
}
