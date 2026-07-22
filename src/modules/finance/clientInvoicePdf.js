import { buildCommercialDocumentPdf } from './commercialDocumentTemplate.js';

export function buildClientInvoicePdfBuffer(docRow, orgProfile) {
  return buildCommercialDocumentPdf(docRow, orgProfile, 'client_invoice');
}
