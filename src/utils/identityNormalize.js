import { AppError } from './helpers.js';

/** Lowercase trimmed email, or empty string. */
export function normalizeEmail(value) {
  return String(value || '').toLowerCase().trim();
}

/**
 * Canonical phone key for duplicate detection.
 * Keeps digits only; for 11+ digit numbers starting with 91, uses last 10 digits
 * (common India mobile form). Shorter values keep all digits.
 */
export function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length >= 12 && digits.startsWith('91')) return digits.slice(-10);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(-10);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

export function emailsEqual(a, b) {
  const ea = normalizeEmail(a);
  const eb = normalizeEmail(b);
  return Boolean(ea && eb && ea === eb);
}

export function phonesEqual(a, b) {
  const pa = normalizePhone(a);
  const pb = normalizePhone(b);
  return Boolean(pa && pb && pa === pb);
}

/**
 * Scan active rows for email or phone clashes.
 * @param {Array<object>} rows
 * @param {{ email?: string, phone?: string, excludeId?: string, emailFields?: string[], phoneFields?: string[], label?: string }} opts
 */
export function findIdentityClash(rows, opts = {}) {
  const email = normalizeEmail(opts.email);
  const phone = normalizePhone(opts.phone);
  const excludeId = opts.excludeId != null ? String(opts.excludeId) : null;
  const emailFields = opts.emailFields || ['email'];
  const phoneFields = opts.phoneFields || ['contact', 'mobile', 'phone'];
  const label = opts.label || 'Record';

  for (const row of rows || []) {
    if (!row || row.isDeleted) continue;
    if (excludeId && String(row._id) === excludeId) continue;

    if (email) {
      for (const field of emailFields) {
        if (emailsEqual(row[field], email)) {
          return {
            row,
            type: 'email',
            message: `${label} with this email already exists`,
            code: 'DUPLICATE_EMAIL',
          };
        }
      }
    }

    if (phone) {
      for (const field of phoneFields) {
        if (phonesEqual(row[field], phone)) {
          return {
            row,
            type: 'phone',
            message: `${label} with this phone number already exists`,
            code: 'DUPLICATE_PHONE',
          };
        }
      }
    }
  }

  return null;
}

export function throwIfIdentityClash(rows, opts) {
  const clash = findIdentityClash(rows, opts);
  if (clash) throw new AppError(clash.message, 409, clash.code);
  return null;
}
