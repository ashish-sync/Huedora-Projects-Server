import { buildCommercialDocumentPdf } from './commercialDocumentTemplate.js';

export function buildDebitNotePdfBuffer(docRow, orgProfile) {
  return buildCommercialDocumentPdf(docRow, orgProfile, 'debit_note');
}
