const SENSITIVE_KEYS = ['recipientAccessToken', 'recipientShortCode'];

/** Strip signing secrets from agreement payloads returned to internal APIs. */
export function redactAgreement(agreement) {
  const obj = agreement?.toObject ? agreement.toObject() : { ...(agreement || {}) };
  for (const key of SENSITIVE_KEYS) {
    delete obj[key];
  }
  return obj;
}

export function redactAgreementList(rows = []) {
  return rows.map((row) => redactAgreement(row));
}
