/**
 * Normalize entity ids used across camps, Client Master, and contacts.
 * 24-char hex ObjectId-like values compare and store case-insensitively.
 */

export function isHexObjectId(value) {
  return /^[a-f0-9]{24}$/i.test(String(value ?? ''));
}

export function normalizeEntityId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return isHexObjectId(raw) ? raw.toLowerCase() : raw;
}

export function idsEqual(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  if (left === right) return true;
  if (isHexObjectId(left) && isHexObjectId(right)) {
    return left.toLowerCase() === right.toLowerCase();
  }
  return false;
}

/** Prefer lowercase hex keys in Maps so F6342… and f6342… collide correctly. */
export function entityIdMapKey(value) {
  return normalizeEntityId(value);
}

const ID_FIELD_SUFFIX = /(^_id$|Id$)/;

/**
 * Lowercase hex `_id` / `*Id` fields on a document before persistence.
 * Does not touch non-hex business codes.
 */
export function normalizeDocumentEntityIds(doc = {}) {
  if (!doc || typeof doc !== 'object') return doc;
  for (const [key, value] of Object.entries(doc)) {
    if (value == null || value === '') continue;
    if (!ID_FIELD_SUFFIX.test(key)) continue;
    if (typeof value === 'string' || typeof value === 'number') {
      doc[key] = normalizeEntityId(value) || value;
    }
  }
  return doc;
}
