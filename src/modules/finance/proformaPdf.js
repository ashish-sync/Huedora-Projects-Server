import { buildCommercialDocumentPdf } from './commercialDocumentTemplate.js';

export function buildProformaPdfBuffer(docRow, orgProfile) {
  return buildCommercialDocumentPdf(docRow, orgProfile, 'proforma');
}
