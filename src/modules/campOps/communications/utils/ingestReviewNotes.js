import { PENDING_EMAIL_CLIENT_CODE } from '../services/ensureServiceUsers.js';

import { isValidCampName } from '../config/campNames.js';

const GENERIC_DIVISION_NAMES = new Set([
  'screening',
  'general',
  '',
]);

export function appendIngestReviewRemarks(row, client) {
  const notes = [];
  if (client?.code === PENDING_EMAIL_CLIENT_CODE) {
    notes.push('Client not matched from request — assign a client in Client Master before approval.');
  }

  const campDivision = String(row.campaignType || '').trim();
  const campCampName = String(row.campaignName || '').trim();
  if (!campDivision || GENERIC_DIVISION_NAMES.has(campDivision.toLowerCase())) {
    notes.push('Division / business unit not matched — set a valid Client Master division before approval.');
  }
  if (!campCampName || !isValidCampName(campCampName)) {
    notes.push('Camp name not matched — set a valid camp name from Client Master before approval.');
  }

  if (!notes.length) return row;

  return {
    ...row,
    remarks: [row.remarks, ...notes].filter(Boolean).join(' '),
  };
}
