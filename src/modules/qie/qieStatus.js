/** QIE indicator + status helpers. Green requires successful credential verification + HR approve. */

export const QIE_INDICATORS = Object.freeze({
  GREY: 'grey',
  AMBER: 'amber',
  GREEN: 'green',
  RED: 'red',
});

export const QIE_STATUSES = Object.freeze({
  QUEUED: 'queued',
  PROCESSING: 'processing',
  HR_REVIEW: 'hr_review',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  DISCREPANCY: 'discrepancy',
  HELD: 'held',
  ESCALATED: 'escalated',
  FAILED: 'failed',
});

export const QIE_HR_ACTIONS = Object.freeze({
  APPROVE: 'approve',
  HOLD: 'hold',
  REJECT: 'reject',
  ESCALATE: 'escalate',
});

export const EDUCATIONAL_QIE_DOC_TYPES = new Set([
  'educational_qualification',
  'employee_educational_qualification',
]);

/**
 * Critical rule: a clean AI/forensic scan alone must NEVER yield green.
 * Green only when credential verification passed AND HR approved.
 */
export function deriveQieIndicator(record = {}) {
  if (!record || !String(record.storedPath || '').trim()) return QIE_INDICATORS.GREY;

  const credentialPassed = Boolean(record.credentialVerification?.passed);
  const hrAction = String(record.hrDecision?.action || '').trim();
  const status = String(record.status || '').trim();

  if (status === QIE_STATUSES.VERIFIED && credentialPassed && hrAction === QIE_HR_ACTIONS.APPROVE) {
    return QIE_INDICATORS.GREEN;
  }

  if (
    status === QIE_STATUSES.REJECTED
    || status === QIE_STATUSES.DISCREPANCY
    || status === QIE_STATUSES.FAILED
    || hrAction === QIE_HR_ACTIONS.REJECT
  ) {
    return QIE_INDICATORS.RED;
  }

  return QIE_INDICATORS.AMBER;
}

export function emptyQieSummary() {
  return {
    verificationId: '',
    indicator: QIE_INDICATORS.GREY,
    status: '',
    documentId: '',
    updatedAt: '',
  };
}

export function qieSummaryFromRecord(record) {
  if (!record) return emptyQieSummary();
  return {
    verificationId: String(record._id || ''),
    indicator: deriveQieIndicator(record),
    status: String(record.status || ''),
    documentId: String(record.documentId || ''),
    updatedAt: record.updatedAt || new Date().toISOString(),
  };
}

export function pushQieHistory(record, entry = {}) {
  const history = Array.isArray(record.history) ? [...record.history] : [];
  history.push({
    at: new Date().toISOString(),
    actorId: entry.actorId || null,
    actorEmail: entry.actorEmail || 'system',
    action: String(entry.action || ''),
    from: String(entry.from || ''),
    to: String(entry.to || ''),
    meta: entry.meta || {},
  });
  // Cap history growth for filedb documents.
  record.history = history.slice(-200);
  return record;
}
