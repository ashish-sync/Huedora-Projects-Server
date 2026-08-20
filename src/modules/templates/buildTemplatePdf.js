/**

 * Build agreement/template PDF from a filled DOCX via Microsoft Word or LibreOffice.

 * PDFKit reconstruction is only for legacy TEXT templates (no Word file).

 */

import { convertDocxBufferToPdf, docxPdfEngineLabel } from './docxToPdf.js';

import { stampSignatureFooterOnPdf } from './pdfSignatureStamp.js';

import { textToPdfBuffer } from './docxPlaceholders.js';

import { PdfEngineUnavailableError } from './pdfEngineErrors.js';



/**

 * @param {object} args

 * @param {string} args.title

 * @param {Buffer|null} [args.filledDocxBuffer]

 * @param {string} [args.filledText]

 * @param {object[]} [args.blocks]

 * @param {object} [args.pdfOptions]

 * @param {boolean} [args.allowPdfKitFallback] - only for legacy TEXT templates

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

    if (!converted?.buffer) {

      throw new PdfEngineUnavailableError(

        'Word-faithful PDF needs Microsoft Word or LibreOffice. PDFKit layout rebuild is disabled for Word templates.'

      );

    }

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



  if (!allowPdfKitFallback) {

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


