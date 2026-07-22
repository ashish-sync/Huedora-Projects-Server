import { buildCommercialDocumentPdf } from './commercialDocumentTemplate.js';

export function buildCreditNotePdfBuffer(docRow, orgProfile) {
  return buildCommercialDocumentPdf(docRow, orgProfile, 'credit_note');
}
