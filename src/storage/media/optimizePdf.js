import { PDFDocument } from 'pdf-lib';

/**
 * Conservative PDF optimize: re-save only when smaller and page count unchanged.
 * Never converts PDF to images/WebP.
 * @param {Buffer} inputBuffer
 * @returns {Promise<{ buffer: Buffer, optimized: boolean, pageCount: number }>}
 */
export async function optimizePdfBuffer(inputBuffer) {
  const input = Buffer.isBuffer(inputBuffer) ? inputBuffer : Buffer.from(inputBuffer);
  let doc;
  try {
    doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return { buffer: input, optimized: false, pageCount: 0 };
  }

  const pageCount = doc.getPageCount();
  if (pageCount < 1) {
    return { buffer: input, optimized: false, pageCount };
  }

  let out;
  try {
    out = Buffer.from(await doc.save({ useObjectStreams: true }));
  } catch {
    return { buffer: input, optimized: false, pageCount };
  }

  if (out.length > 0 && out.length < input.length) {
    // Re-load to confirm page count survived
    try {
      const check = await PDFDocument.load(out, { ignoreEncryption: true });
      if (check.getPageCount() === pageCount) {
        return { buffer: out, optimized: true, pageCount };
      }
    } catch {
      /* keep original */
    }
  }

  return { buffer: input, optimized: false, pageCount };
}
