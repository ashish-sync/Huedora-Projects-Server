import { buildCommercialDocumentPdf } from './commercialDocumentTemplate.js';

export function buildQuotationPdfBuffer(docRow, orgProfile) {
  return buildCommercialDocumentPdf(docRow, orgProfile, 'quotation');
}
