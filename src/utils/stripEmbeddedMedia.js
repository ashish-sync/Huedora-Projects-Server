/**
 * Strip embedded data-URLs / media fields from payloads before persist or audit.
 * Org profile remains the canonical store for logo / QR / signature.
 */

const MEDIA_KEYS = new Set([
  'logoDataUrl',
  'paymentQrDataUrl',
  'signatureDataUrl',
  'imageDataUrl',
]);

const DATA_URL_RE = /^data:(image|application)\//i;

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Deep-strip known media keys and any data: URL strings.
 * Returns a new value (does not mutate input).
 */
export function stripEmbeddedMedia(value, { maxDepth = 14 } = {}) {
  return stripValue(value, 0, maxDepth, { omitBuilderForm: false, forAudit: false });
}

/**
 * Sanitize audit before/after snapshots: drop builderForm blobs, media, and truncate large strings.
 */
export function sanitizeAuditSnapshot(value, { maxDepth = 8, maxString = 4000, maxArray = 40 } = {}) {
  return stripValue(value, 0, maxDepth, {
    omitBuilderForm: true,
    forAudit: true,
    maxString,
    maxArray,
  });
}

function stripValue(value, depth, maxDepth, opts) {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (DATA_URL_RE.test(value) || value.startsWith('data:image')) {
      return opts.forAudit ? '[omitted:data-url]' : '';
    }
    if (opts.forAudit && value.length > (opts.maxString || 4000)) {
      return `${value.slice(0, opts.maxString)}…[truncated]`;
    }
    return value;
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= maxDepth) {
    return opts.forAudit ? '[omitted:depth]' : value;
  }

  if (Array.isArray(value)) {
    const limit = opts.forAudit ? opts.maxArray || 40 : value.length;
    const slice = value.slice(0, limit).map((item) => stripValue(item, depth + 1, maxDepth, opts));
    if (opts.forAudit && value.length > limit) {
      slice.push(`…[+${value.length - limit} items]`);
    }
    return slice;
  }

  if (!isPlainObject(value)) return value;

  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (opts.omitBuilderForm && key === 'builderForm') {
      out.builderForm = '[omitted:builderForm]';
      continue;
    }
    if (MEDIA_KEYS.has(key)) {
      out[key] = opts.forAudit ? (child ? '[omitted:media]' : child || '') : '';
      continue;
    }
    out[key] = stripValue(child, depth + 1, maxDepth, opts);
  }
  return out;
}

/** Strip media from a commercial builderForm object (or return null). */
export function stripBuilderFormMedia(builderForm) {
  if (builderForm == null) return null;
  if (typeof builderForm !== 'object') return null;
  return stripEmbeddedMedia(builderForm);
}
