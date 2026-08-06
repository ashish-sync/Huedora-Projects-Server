import { buildDeliveryChallanTemplatePdf } from './deliveryChallanTemplate.js';

export function buildDeliveryChallanPdfBuffer(docRow, orgProfile) {
  return buildDeliveryChallanTemplatePdf(docRow, orgProfile);
}
