import { buildCommercialDocumentPdf } from './commercialDocumentTemplate.js';

export function buildPurchaseOrderPdfBuffer(docRow, orgProfile) {
  return buildCommercialDocumentPdf(docRow, orgProfile, 'purchase_order');
}
