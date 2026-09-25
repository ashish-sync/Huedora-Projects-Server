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
 * - Non-empty arrays replace when present.
 * - Empty arrays `[]` are treated as blank: they do **not** wipe a non-empty
 *   existing array unless `clearKeys` / `allowBlankClear` (explicit clear).
 *   Callers that intend a destructive clear must pass `clearKeys` (or omit
 *   the key entirely to leave the existing array untouched).
 */
export function mergeDocumentFields(existing = {}, incoming = {}, options = {}) {
  const allowBlankClear = options.allowBlankClear === true;
  const clearKeys = new Set(options.clearKeys || []);
  const out = { ...(existing && typeof existing === 'object' ? existing : {}) };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      const explicitClear = allowBlankClear || clearKeys.has(key);
      if (
        value.length === 0
        && !explicitClear
        && Array.isArray(out[key])
        && out[key].length > 0
      ) {
        continue;
      }
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

/**
 * Normalize clearKeys from a request body (array, comma string, or nested clearKeys).
 * Also accepts boolean flags like clearExecutionDocuments / clearConsumablesUsed /
 * clearProviderEmployees mapped to field names.
 */
export function resolveClearKeys(body = {}, flagToKey = {}) {
  const keys = new Set();
  const raw = body?.clearKeys;
  if (Array.isArray(raw)) {
    raw.forEach((k) => {
      const key = String(k || '').trim();
      if (key) keys.add(key);
    });
  } else if (typeof raw === 'string' && raw.trim()) {
    raw.split(',').forEach((k) => {
      const key = k.trim();
      if (key) keys.add(key);
    });
  }
  for (const [flag, field] of Object.entries(flagToKey || {})) {
    const v = body?.[flag];
    if (v === true || v === 'true' || v === 1 || v === '1') {
      keys.add(field);
    }
  }
  return [...keys];
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
