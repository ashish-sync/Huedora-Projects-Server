import { buildPurchaseOrderTemplatePdf } from './purchaseOrderTemplate.js';

export function buildPurchaseOrderPdfBuffer(docRow, orgProfile) {
  return buildPurchaseOrderTemplatePdf(docRow, orgProfile);
}
