/**
 * Form Master field runtime — format transforms, pattern checks, showWhen,
 * and form-level settings used when saving/applying a Form Master.
 */

export const DEFAULT_FORM_SETTINGS = {
  allowExcelUpload: true,
  enforceFieldRules: true,
};

export function defaultFormSettingsForCategory(category = '') {
  const cat = String(category || '').toUpperCase();
  if (cat === 'PUBLIC_CAMP_REQUEST') {
    return {
      allowExcelUpload: true,
      enforceFieldRules: true,
    };
  }
  if (cat === 'HCW_ACTIVITY') {
    return {
      allowExcelUpload: false,
      enforceFieldRules: true,
    };
  }
  return { ...DEFAULT_FORM_SETTINGS };
}

function boolOr(raw, fallback) {
  if (raw === true || raw === 'true' || raw === 1) return true;
  if (raw === false || raw === 'false' || raw === 0) return false;
  return fallback;
}

export function normalizeFormSettings(raw = {}, category = '') {
  const defaults = defaultFormSettingsForCategory(category);
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    allowExcelUpload: boolOr(src.allowExcelUpload, defaults.allowExcelUpload),
    enforceFieldRules: boolOr(src.enforceFieldRules, defaults.enforceFieldRules),
  };
}

export function compilePattern(pattern) {
  const raw = String(pattern || '').trim();
  if (!raw) return { ok: true, regex: null };
  try {
    return { ok: true, regex: new RegExp(raw) };
  } catch (err) {
    return { ok: false, regex: null, error: err?.message || 'Invalid regular expression' };
  }
}

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function digitsOnly(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

/** Apply a Form Master format transform to a raw input value. */
export function applyFieldFormat(value, format) {
  const fmt = String(format || '').trim().toLowerCase();
  if (!fmt || value == null) return value;
  if (typeof value === 'boolean') return value;

  const text = String(value);
  switch (fmt) {
    case 'uppercase':
      return text.toUpperCase();
    case 'lowercase':
      return text.toLowerCase();
    case 'titlecase':
      return titleCase(text);
    case 'digits':
      return digitsOnly(text);
    case 'phone-in': {
      const digits = digitsOnly(text).slice(0, 10);
      return digits;
    }
    case 'email':
      return text.trim().toLowerCase();
    case 'url':
      return text.trim();
    case 'date-iso':
      return text.trim().slice(0, 10);
    case 'time-24h': {
      const trimmed = text.trim();
      const match = trimmed.match(/^(\d{1,2}):(\d{1,2})/);
      if (!match) return trimmed;
      const hh = String(Math.min(23, Number(match[1]))).padStart(2, '0');
      const mm = String(Math.min(59, Number(match[2]))).padStart(2, '0');
      return `${hh}:${mm}`;
    }
    default:
      return value;
  }
}

export function evaluateShowWhen(rule, values = {}) {
  if (!rule?.field) return true;
  const current = String(values[rule.field] ?? '').trim();
  const expected = String(rule.value ?? '').trim();
  switch (rule.operator) {
    case 'neq':
      return current !== expected;
    case 'in':
      return expected
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .includes(current);
    case 'contains':
      return current.toLowerCase().includes(expected.toLowerCase());
    case 'empty':
      return !current;
    case 'notEmpty':
      return Boolean(current);
    case 'eq':
    default:
      return current === expected;
  }
}

function isEmptyValue(value) {
  if (value == null) return true;
  if (typeof value === 'boolean') return false;
  if (Array.isArray(value)) return value.length === 0;
  return !String(value).trim();
}

function formatSpecificError(format, value) {
  const fmt = String(format || '').trim().toLowerCase();
  const text = String(value ?? '').trim();
  if (!fmt || !text) return '';
  if (fmt === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return 'Enter a valid email address';
  }
  if (fmt === 'url') {
    try {
      // Accept bare domains by prefixing protocol for URL parse.
      // eslint-disable-next-line no-new
      new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
      return 'Enter a valid URL';
    }
  }
  if (fmt === 'phone-in' && !/^\d{10}$/.test(digitsOnly(text))) {
    return 'Enter a valid 10-digit Indian mobile number';
  }
  if (fmt === 'date-iso' && !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return 'Enter a date as YYYY-MM-DD';
  }
  if (fmt === 'time-24h' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    return 'Enter a time as HH:MM (24-hour)';
  }
  return '';
}

/**
 * Validate one field value against a Form Master field definition.
 * Returns an error string or '' when valid.
 */
export function validateFieldValue(field, value, { values = {}, skipHidden = true } = {}) {
  if (!field) return '';
  if (skipHidden && field.showWhen && !evaluateShowWhen(field.showWhen, values)) {
    return '';
  }

  const label = field.label || field.key || 'Field';
  const empty = isEmptyValue(value);

  if (field.required && empty) {
    return `${label} is required`;
  }
  if (empty) return '';

  if (field.type === 'checkbox') return '';

  const text = Array.isArray(value) ? value.join(', ') : String(value);
  const trimmed = text.trim();

  if (field.minLength != null && trimmed.length < Number(field.minLength)) {
    return `${label} must be at least ${field.minLength} characters`;
  }
  if (field.maxLength != null && trimmed.length > Number(field.maxLength)) {
    return `${label} must be at most ${field.maxLength} characters`;
  }

  if (field.type === 'number' || field.type === 'currency') {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return `${label} must be a number`;
    if (field.min != null && n < Number(field.min)) {
      return `${label} must be at least ${field.min}`;
    }
    if (field.max != null && n > Number(field.max)) {
      return `${label} must be at most ${field.max}`;
    }
  }

  if ((field.type === 'date' || field.type === 'time') && field.min != null) {
    if (trimmed < String(field.min)) return `${label} must be on or after ${field.min}`;
  }
  if ((field.type === 'date' || field.type === 'time') && field.max != null) {
    if (trimmed > String(field.max)) return `${label} must be on or before ${field.max}`;
  }

  const formatError = formatSpecificError(field.format, trimmed);
  if (formatError) return `${label}: ${formatError}`;

  if (field.pattern) {
    const compiled = compilePattern(field.pattern);
    if (!compiled.ok) {
      return `${label} has an invalid validation pattern configured`;
    }
    if (compiled.regex && !compiled.regex.test(trimmed)) {
      return `${label} format is invalid`;
    }
  }

  return '';
}

/**
 * Apply formats to values for fields present in both definitions and values.
 */
export function applyFormatsToValues(fields = [], values = {}) {
  const next = { ...values };
  for (const field of fields) {
    if (!field?.key || !(field.key in next)) continue;
    if (field.showWhen && !evaluateShowWhen(field.showWhen, next)) continue;
    if (!field.format) continue;
    next[field.key] = applyFieldFormat(next[field.key], field.format);
  }
  return next;
}

/**
 * Validate all Form Master fields against a values map.
 * Only checks keys that exist on the values object (overlay / known form keys),
 * plus required Form Master fields that are visible.
 */
export function validateFormMasterValues(fields = [], values = {}, options = {}) {
  const errors = [];
  const list = Array.isArray(fields) ? fields : [];
  for (const field of list) {
    if (!field?.key) continue;
    const hasKey = Object.prototype.hasOwnProperty.call(values, field.key);
    // Skip unknown custom keys unless required+visible (still report required miss).
    if (!hasKey && !field.required) continue;
    if (!hasKey && field.showWhen && !evaluateShowWhen(field.showWhen, values)) continue;
    const message = validateFieldValue(field, values[field.key], {
      values,
      skipHidden: options.skipHidden !== false,
    });
    if (message) errors.push(message);
  }
  return errors;
}

/** Camp date must be today or later — historical dates are never allowed. */
export function getFormMasterCampDateErrors(values = {}) {
  const campDate = String(values.campDate || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(campDate)) return [];
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const todayIso = `${y}-${m}-${d}`;
  if (campDate < todayIso) {
    return ['Camp date cannot be in the past'];
  }
  return [];
}
