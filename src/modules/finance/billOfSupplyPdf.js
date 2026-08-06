import { buildCommercialDocumentPdf } from './commercialDocumentTemplate.js';

export function buildBillOfSupplyPdfBuffer(docRow, orgProfile) {
  return buildCommercialDocumentPdf(docRow, orgProfile, 'bill_of_supply');
}
