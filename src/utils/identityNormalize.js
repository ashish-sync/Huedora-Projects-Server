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

/** Email must include @ and a domain with a real suffix (e.g. .com, .in, .net). */
export function isValidEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email);
}

/** Mobile must normalize to exactly 10 digits. */
export function isValidPhone(value) {
  return normalizePhone(value).length === 10;
}

/** Value is either a valid 10-digit phone or a valid email. */
export function isValidPhoneOrEmail(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (raw.includes('@')) return isValidEmail(raw);
  return isValidPhone(raw);
}

export function assertValidEmail(value, label = 'Email') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!isValidEmail(raw)) {
    throw new AppError(
      `${label} must include @ and a valid domain suffix (e.g. .com, .in, .net)`,
      400,
      'VALIDATION_ERROR'
    );
  }
  return normalizeEmail(raw);
}

export function assertValidPhone(value, label = 'Mobile number') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!isValidPhone(raw)) {
    throw new AppError(`${label} must be exactly 10 digits`, 400, 'VALIDATION_ERROR');
  }
  return normalizePhone(raw);
}

export function assertValidPhoneOrEmail(value, label = 'Contact') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!isValidPhoneOrEmail(raw)) {
    throw new AppError(
      `${label} must be a 10-digit mobile number or an email with @ and a valid domain suffix`,
      400,
      'VALIDATION_ERROR'
    );
  }
  return raw.includes('@') ? normalizeEmail(raw) : normalizePhone(raw);
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
