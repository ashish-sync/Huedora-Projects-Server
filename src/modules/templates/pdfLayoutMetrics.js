/**
 * Structural PDF layout metrics for fidelity tests (page count, page size).
 * Word PDF bytes are not deterministic; compare layout, not file hash.
 */
import { PDFDocument } from 'pdf-lib';

/**
 * @param {Buffer|Uint8Array} pdfBuffer
 * @returns {Promise<{ pageCount: number, pages: { index: number, width: number, height: number }[] }>}
 */
export async function pdfLayoutMetrics(pdfBuffer) {
  const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const pages = doc.getPages();
  return {
    pageCount: pages.length,
    pages: pages.map((page, index) => ({
      index,
      width: Math.round(page.getWidth() * 100) / 100,
      height: Math.round(page.getHeight() * 100) / 100,
    })),
  };
}

/**
 * @param {Awaited<ReturnType<typeof pdfLayoutMetrics>>} a
 * @param {Awaited<ReturnType<typeof pdfLayoutMetrics>>} b
 * @param {{ tolerancePt?: number }} [opts]
 */
export function assertPdfLayoutMatch(a, b, opts = {}) {
  const tolerancePt = Number(opts.tolerancePt) >= 0 ? Number(opts.tolerancePt) : 0.5;
  if (a.pageCount !== b.pageCount) {
    throw new Error(`PDF page count mismatch: ${a.pageCount} vs ${b.pageCount}`);
  }
  for (let i = 0; i < a.pages.length; i += 1) {
    const left = a.pages[i];
    const right = b.pages[i];
    if (Math.abs(left.width - right.width) > tolerancePt) {
      throw new Error(
        `Page ${i + 1} width mismatch: ${left.width} vs ${right.width} (tol ${tolerancePt}pt)`
      );
    }
    if (Math.abs(left.height - right.height) > tolerancePt) {
      throw new Error(
        `Page ${i + 1} height mismatch: ${left.height} vs ${right.height} (tol ${tolerancePt}pt)`
      );
    }
  }
}
