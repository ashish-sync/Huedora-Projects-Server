/**
 * Pure helpers for /notifications/unread-count ETag + 304 decisions.
 */

export function weakUnreadEtag(approvals, fyi, sampleIds = []) {
  const head = sampleIds[0] || '0';
  return `W/"n:${Number(approvals) || 0}:${Number(fyi) || 0}:${sampleIds.length}:${head}"`;
}

export function shouldReturnNotModified(ifNoneMatch, etag) {
  const inm = String(ifNoneMatch || '').trim();
  const tag = String(etag || '').trim();
  return Boolean(inm && tag && inm === tag);
}
