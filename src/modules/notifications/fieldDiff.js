/**
 * Build compact old → new change lists for notifications and audit UI.
 * Does not mutate inputs. Caps size for storage safety.
 */

const SKIP_KEYS = new Set([
  '_id',
  '__v',
  'createdAt',
  'updatedAt',
  'passwordHash',
  'builderForm',
  'attachments',
  'files',
  'productImages',
  'photos',
]);

const MAX_CHANGES = 40;
const MAX_VALUE_LEN = 200;

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

function normalizeScalar(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return v;
}

function valuesEqual(a, b) {
  const na = normalizeScalar(a);
  const nb = normalizeScalar(b);
  if (na === nb) return true;
  if (na == null && nb == null) return true;
  return String(na) === String(nb);
}

function truncate(value) {
  if (value == null) return null;
  const s = typeof value === 'string' ? value : String(normalizeScalar(value));
  if (s.length <= MAX_VALUE_LEN) return s;
  return `${s.slice(0, MAX_VALUE_LEN - 1)}…`;
}

function humanLabel(field, labels = {}) {
  if (labels[field]) return labels[field];
  return String(field)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * @returns {{ field: string, label: string, from: *, to: * }[]}
 */
export function buildAuditChanges(before, after, fieldLabels = {}) {
  const changes = [];
  const beforeObj = before && typeof before === 'object' ? before : {};
  const afterObj = after && typeof after === 'object' ? after : {};
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);

  for (const key of keys) {
    if (SKIP_KEYS.has(key)) continue;
    if (key.startsWith('_') && key !== '_id') continue;
    const fromVal = beforeObj[key];
    const toVal = afterObj[key];
    if (isPlainObject(fromVal) || isPlainObject(toVal)) {
      // One-level nested: only compare if both plain or one missing
      if (isPlainObject(fromVal) && isPlainObject(toVal)) {
        const nested = buildAuditChanges(fromVal, toVal, fieldLabels);
        for (const n of nested) {
          changes.push({
            field: `${key}.${n.field}`,
            label: `${humanLabel(key, fieldLabels)} › ${n.label}`,
            from: n.from,
            to: n.to,
          });
          if (changes.length >= MAX_CHANGES) return changes;
        }
        continue;
      }
    }
    if (valuesEqual(fromVal, toVal)) continue;
    changes.push({
      field: key,
      label: humanLabel(key, fieldLabels),
      from: truncate(fromVal),
      to: truncate(toVal),
    });
    if (changes.length >= MAX_CHANGES) break;
  }
  return changes;
}

/** Compact one-line summary for audit.message */
export function summarizeChanges(changes = [], max = 3) {
  if (!Array.isArray(changes) || !changes.length) return '';
  const parts = changes.slice(0, max).map((c) => {
    const from = c.from == null || c.from === '' ? '—' : c.from;
    const to = c.to == null || c.to === '' ? '—' : c.to;
    return `${c.label || c.field}: ${from} → ${to}`;
  });
  const extra = changes.length > max ? ` (+${changes.length - max} more)` : '';
  return parts.join('; ') + extra;
}

export function mergeChangeLists(existing = [], incoming = []) {
  const byField = new Map();
  for (const c of [...(existing || []), ...(incoming || [])]) {
    if (!c?.field) continue;
    const prev = byField.get(c.field);
    if (!prev) {
      byField.set(c.field, { ...c });
    } else {
      byField.set(c.field, {
        ...prev,
        ...c,
        from: prev.from,
        to: c.to,
      });
    }
  }
  return Array.from(byField.values()).slice(0, MAX_CHANGES);
}
