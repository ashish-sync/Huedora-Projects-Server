/**
 * Data integrity helpers — no silent data loss.
 * Prefer these over raw Object.assign / full-document replace on updates.
 */

export function isBlankValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/**
 * Merge incoming onto existing.
 * - `undefined` keys are skipped (partial update).
 * - Blank strings/`null` do not erase a non-blank existing value unless
 *   `allowBlankClear` or the key is listed in `clearKeys`.
 * - Arrays (including `[]`) are applied when present — callers must omit the
 *   key to leave existing arrays untouched.
 */
export function mergeDocumentFields(existing = {}, incoming = {}, options = {}) {
  const allowBlankClear = options.allowBlankClear === true;
  const clearKeys = new Set(options.clearKeys || []);
  const out = { ...(existing && typeof existing === 'object' ? existing : {}) };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      out[key] = value;
      continue;
    }
    if (
      !allowBlankClear
      && !clearKeys.has(key)
      && isBlankValue(value)
      && !isBlankValue(out[key])
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Assign only defined keys onto a mutable target (same blank-preserve rules). */
export function assignPreservingExisting(target, incoming = {}, options = {}) {
  if (!target || typeof target !== 'object') return target;
  const merged = mergeDocumentFields(
    target.toObject ? target.toObject() : target,
    incoming,
    options
  );
  for (const [key, value] of Object.entries(merged)) {
    if (key === '_id') continue;
    target[key] = value;
  }
  return target;
}

/**
 * Build a patch object from raw body: keep only keys that were actually sent
 * and are non-blank (unless listed in clearKeys / allowBlankClear).
 */
export function pickDefinedPatch(body = {}, { allowKeys = null, clearKeys = [] } = {}) {
  const allow = allowKeys ? new Set(allowKeys) : null;
  const clear = new Set(clearKeys);
  const out = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (allow && !allow.has(key)) continue;
    if (value === undefined) continue;
    if (isBlankValue(value) && !clear.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Optimistic concurrency: reject stale saves when the client still holds an older updatedAt.
 * @throws {{ status: 409, code: 'STALE_UPDATE', message: string }}
 */
export function assertNotStale(existing, expectedUpdatedAt, { label = 'Record' } = {}) {
  if (expectedUpdatedAt == null || expectedUpdatedAt === '') return;
  const current = String(existing?.updatedAt || '');
  const expected = String(expectedUpdatedAt);
  if (!current || !expected) return;
  if (current !== expected) {
    const err = new Error(
      `${label} was changed elsewhere. Reload and try again to avoid overwriting newer data.`
    );
    err.status = 409;
    err.code = 'STALE_UPDATE';
    throw err;
  }
}
