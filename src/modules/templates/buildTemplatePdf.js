/**
 * Build agreement/template PDF from a filled DOCX via Microsoft Word or LibreOffice.
 * PDFKit reconstruction is used for legacy TEXT templates, and as a last-resort
 * fallback when Word/LibreOffice are not installed (set DOCX_PDF_REQUIRE_ENGINE=true
 * to hard-fail instead).
 */
import { convertDocxBufferToPdf, docxPdfEngineLabel } from './docxToPdf.js';
import { stampSignatureFooterOnPdf } from './pdfSignatureStamp.js';
import { textToPdfBuffer } from './docxPlaceholders.js';
import { PdfEngineUnavailableError } from './pdfEngineErrors.js';

function requireDocxPdfEngine() {
  return String(process.env.DOCX_PDF_REQUIRE_ENGINE || '').toLowerCase() === 'true';
}

/**
 * @param {object} args
 * @param {string} args.title
 * @param {Buffer|null} [args.filledDocxBuffer]
 * @param {string} [args.filledText]
 * @param {object[]} [args.blocks]
 * @param {object} [args.pdfOptions]
 * @param {boolean} [args.allowPdfKitFallback]
 * @returns {Promise<{ buffer: Buffer, engine: 'msword'|'libreoffice'|'pdfkit' }>}
 */
export async function buildTemplatePdf({
  title,
  filledDocxBuffer = null,
  filledText = '',
  blocks = null,
  pdfOptions = {},
  allowPdfKitFallback = true,
} = {}) {
  const showSignatures = pdfOptions.showSignatures !== false;

  if (Buffer.isBuffer(filledDocxBuffer) && filledDocxBuffer.length > 64) {
    const converted = await convertDocxBufferToPdf(filledDocxBuffer);
    if (converted?.buffer) {
      let buffer = converted.buffer;
      if (showSignatures) {
        try {
          buffer = await stampSignatureFooterOnPdf(converted.buffer, pdfOptions);
        } catch (err) {
          console.warn('[buildTemplatePdf] Signature stamp failed:', err?.message || err);
          buffer = converted.buffer;
        }
      }
      return { buffer, engine: converted.engine };
    }

    const hardFail = requireDocxPdfEngine() || !allowPdfKitFallback;
    if (hardFail) {
      throw new PdfEngineUnavailableError(
        'Word-faithful PDF needs Microsoft Word or LibreOffice. '
          + 'Install LibreOffice on the API host (or set LIBREOFFICE_PATH), '
          + 'or unset DOCX_PDF_REQUIRE_ENGINE to allow a PDFKit layout rebuild.',
      );
    }

    console.warn(
      '[buildTemplatePdf] Word/LibreOffice unavailable — falling back to PDFKit rebuild. '
        + 'Install LibreOffice Writer for Word-faithful PDFs (LIBREOFFICE_PATH / soffice).',
    );
  }

  if (!allowPdfKitFallback && !(Buffer.isBuffer(filledDocxBuffer) && filledDocxBuffer.length > 64)) {
    throw new PdfEngineUnavailableError('No Word document buffer available for PDF conversion.');
  }

  const buffer = await textToPdfBuffer(title, filledText, {
    ...pdfOptions,
    blocks: blocks?.length ? blocks : undefined,
    omitAppChrome: Boolean(blocks?.length),
  });
  return { buffer, engine: 'pdfkit' };
}

export { docxPdfEngineLabel };
