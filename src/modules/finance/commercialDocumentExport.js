import { DOCUMENT_NUMBER_LABELS } from './documentNumbering.js';
import {
  displayCommercialStage,
  resolveCommercialDisplayStatus,
} from './financeCommercial.service.js';

/** Cell value for one Saved Documents Excel column. */
export function commercialExportValue(row, key) {
  if (key === 'documentType') {
    return DOCUMENT_NUMBER_LABELS[row.documentType] || row.documentType || '';
  }
  if (key === 'stage') return displayCommercialStage(row.status);
  if (key === 'status') return resolveCommercialDisplayStatus(row) || '';
  if (key === 'reference') return row.servicePeriod || row.projectName || '';
  if (key === 'organisation') {
    return row.orgSnapshot?.name || row.orgSnapshot?.legalName || '';
  }
  return row[key] ?? '';
}
