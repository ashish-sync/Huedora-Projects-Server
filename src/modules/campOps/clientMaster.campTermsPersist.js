/**
 * Pure helpers for Client Master Camp Terms persistence.
 * Empty placeholder arrays from the form must never wipe stored PO / agreement data.
 */

function trimStr(value) {
  return value == null ? '' : String(value).trim();
}

export function isMeaningfulPurchaseOrder(row) {
  if (!row || typeof row !== 'object') return false;
  return Boolean(
    trimStr(row.poNumber)
    || Number(row.poNetValue) > 0
    || Number(row.poGrossValue) > 0
    || row.poFile?.storedName
    || (Array.isArray(row.files) && row.files.length)
    || trimStr(row.poIssueDate)
    || trimStr(row.poExpiryDate)
  );
}

/**
 * Resolve purchaseOrders for persist.
 * - undefined body → keep existing (caller handles legacy flat fields)
 * - empty / placeholder-only body → keep existing (no silent wipe)
 * - meaningful body rows → use mapped rows
 */
export function resolvePurchaseOrdersForPersist(bodyOrders, existingOrders = [], { mapRow } = {}) {
  if (bodyOrders === undefined) return { changed: false, orders: existingOrders || [] };
  if (!Array.isArray(bodyOrders)) return { changed: false, orders: existingOrders || [] };

  const existing = Array.isArray(existingOrders) ? existingOrders : [];
  const mapped = typeof mapRow === 'function'
    ? bodyOrders.map(mapRow).filter(Boolean)
    : bodyOrders.filter(isMeaningfulPurchaseOrder);

  if (mapped.length) return { changed: true, orders: mapped };
  return { changed: false, orders: existing };
}

/**
 * Resolve dedicated agreement/approval attachments (campTermsFiles).
 * Empty body array must not erase stored files (deletes use the file DELETE endpoint).
 */
export function resolveCampTermsFilesForPersist(bodyFiles, existingFiles = []) {
  const existing = Array.isArray(existingFiles)
    ? existingFiles.filter((doc) => doc && (doc.storedName || doc.id || doc.fileName))
    : [];
  if (bodyFiles === undefined) return { changed: false, files: existing };
  if (!Array.isArray(bodyFiles)) return { changed: false, files: existing };

  const incoming = bodyFiles.filter((doc) => doc && (doc.storedName || doc.id || doc.fileName));
  if (incoming.length) return { changed: true, files: incoming };
  return { changed: false, files: existing };
}
