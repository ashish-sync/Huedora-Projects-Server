/**
 * Build agreement/template PDF from a filled DOCX when possible (LibreOffice),
 * otherwise PDFKit block reconstruction.
 */
import { convertDocxBufferToPdf, docxPdfEngineLabel } from './docxToPdf.js';
import { stampSignatureFooterOnPdf } from './pdfSignatureStamp.js';
import { textToPdfBuffer } from './docxPlaceholders.js';

/**
 * @param {object} args
 * @param {string} args.title
 * @param {Buffer|null} [args.filledDocxBuffer]
 * @param {string} [args.filledText]
 * @param {object[]} [args.blocks]
 * @param {object} [args.pdfOptions]
 * @returns {Promise<{ buffer: Buffer, engine: 'libreoffice'|'pdfkit' }>}
 */
export async function buildTemplatePdf({
  title,
  filledDocxBuffer = null,
  filledText = '',
  blocks = null,
  pdfOptions = {},
} = {}) {
  const showSignatures = pdfOptions.showSignatures !== false;

  if (Buffer.isBuffer(filledDocxBuffer) && filledDocxBuffer.length > 64) {
    const converted = await convertDocxBufferToPdf(filledDocxBuffer);
    if (converted) {
      let buffer = converted;
      if (showSignatures) {
        try {
          buffer = await stampSignatureFooterOnPdf(converted, pdfOptions);
        } catch (err) {
          console.warn('[buildTemplatePdf] Signature stamp failed:', err?.message || err);
          buffer = converted;
        }
      }
      return { buffer, engine: 'libreoffice' };
    }
  }

  const buffer = await textToPdfBuffer(title, filledText, {
    ...pdfOptions,
    blocks: blocks?.length ? blocks : undefined,
  });
  return { buffer, engine: 'pdfkit' };
}

export { docxPdfEngineLabel };
