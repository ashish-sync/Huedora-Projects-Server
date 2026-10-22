import { AppError } from '../../utils/helpers.js';
import { nextSequence, releaseSequence } from '../../utils/counters.js';

/**
 * Standard commercial document numbering: PREFIXFY/MM/SEQ
 * PREFIX = {org documentCode}{type suffix}
 * e.g. TCIN26-27/08/001 — Tylo Care Tax Invoice, FY 26-27, August, 1st of the month
 *
 * Type suffixes:
 * IN – Tax Invoice · PO – Purchase Order · PI – Proforma Invoice · QT – Quotation
 * CN – Credit Note · DN – Debit Note · DC – Delivery Challan · BS – Bill of Supply
 *
 * Legacy PREFIX/FY/MM/SEQ (slash after prefix) is still parsed for existing issued docs.
 */
export const DEFAULT_DOCUMENT_CODE = 'TC';

export const DOCUMENT_TYPE_SUFFIXES = {
  client_invoice: 'IN',
  purchase_order: 'PO',
  proforma: 'PI',
  quotation: 'QT',
  credit_note: 'CN',
  debit_note: 'DN',
  delivery_challan: 'DC',
  bill_of_supply: 'BS',
};

const SUFFIX_TO_TYPE = Object.fromEntries(
  Object.entries(DOCUMENT_TYPE_SUFFIXES).map(([type, suffix]) => [suffix, type]),
);

const TYPE_SUFFIX_GROUP = Object.values(DOCUMENT_TYPE_SUFFIXES).join('|');

export function normalizeDocumentCode(value) {
  const raw = readExplicitDocumentCode(value);
  return raw || DEFAULT_DOCUMENT_CODE;
}

/** Return a 2–5 letter code, or '' — never invent TC for a missing org code. */
export function readExplicitDocumentCode(value) {
  if (value && typeof value === 'object') {
    value = value.documentCode;
  }
  const raw = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return raw.length >= 2 && raw.length <= 5 ? raw : '';
}

export function isValidDocumentCode(value) {
  return /^[A-Z]{2,5}$/.test(String(value || '').trim().toUpperCase());
}

export function prefixForDocumentType(documentType, documentCode = DEFAULT_DOCUMENT_CODE) {
  const suffix = DOCUMENT_TYPE_SUFFIXES[documentType];
  if (!suffix) return '';
  return `${normalizeDocumentCode(documentCode)}${suffix}`;
}

/** Default (Tylo Care) prefixes — kept for API meta and existing docs. */
export const DOCUMENT_NUMBER_PREFIXES = Object.fromEntries(
  Object.entries(DOCUMENT_TYPE_SUFFIXES).map(([type, suffix]) => [type, `${DEFAULT_DOCUMENT_CODE}${suffix}`]),
);

export const DOCUMENT_NUMBER_LABELS = {
  client_invoice: 'Tax Invoice',
  purchase_order: 'Purchase Order',
  proforma: 'Proforma Invoice',
  quotation: 'Quotation',
  credit_note: 'Credit Note',
  debit_note: 'Debit Note',
  delivery_challan: 'Delivery Challan',
  bill_of_supply: 'Bill of Supply',
};

/** Human-readable standards for UI / API meta */
export const DOCUMENT_NUMBER_STANDARDS = Object.entries(DOCUMENT_NUMBER_PREFIXES).map(
  ([documentType, prefix]) => ({
    documentType,
    prefix,
    label: DOCUMENT_NUMBER_LABELS[documentType] || documentType,
    example: `${prefix}26-27/08/001`,
  }),
);

export function numberingPreviewForCode(documentCode = DEFAULT_DOCUMENT_CODE) {
  const code = normalizeDocumentCode(documentCode);
  return Object.entries(DOCUMENT_TYPE_SUFFIXES).map(([documentType, suffix]) => ({
    documentType,
    prefix: `${code}${suffix}`,
    label: DOCUMENT_NUMBER_LABELS[documentType] || documentType,
    example: `${code}${suffix}26-27/08/001`,
  }));
}

/** Current: TCIN26-27/08/001 — optional slash after prefix kept for legacy PREFIX/FY/... */
const NUMBER_PATTERN = new RegExp(
  `^([A-Z]{2,5})(${TYPE_SUFFIX_GROUP})(?:\\/)?(\\d{2}-\\d{2})(?:\\/(\\d{2}))?\\/(\\d{3,})$`,
  'i',
);
const SHORT_LEGACY_PATTERN = new RegExp(
  `^(${TYPE_SUFFIX_GROUP}|TYLO)(?:\\/)?(\\d{2}-\\d{2})(?:\\/(\\d{2}))?\\/(\\d{3,})$`,
  'i',
);
const LEGACY_DASH_PATTERN = /^(TCIN|TCPO|TCPI|TCCN)-(\d{2})-(\d{2})-(\d{3,})$/i;

const SEQ_DIGITS = 3;

/** Indian FY label e.g. 26-27 for dates in Apr 2026 – Mar 2027 */
export function fiscalYearLabel(dateIso) {
  const d = parseDate(dateIso);
  const month = d.getMonth(); // 0-based
  const year = d.getFullYear();
  const startYear = month >= 3 ? year : year - 1;
  const endShort = String(startYear + 1).slice(-2);
  return `${String(startYear).slice(-2)}-${endShort}`;
}

function toLocalYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDate(dateIso) {
  if (!dateIso) return new Date();
  if (dateIso instanceof Date) {
    return Number.isNaN(dateIso.getTime()) ? new Date() : dateIso;
  }
  const raw = String(dateIso).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(dateIso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function documentNumberPeriod(dateIso) {
  const d = parseDate(dateIso);
  const fy = fiscalYearLabel(toLocalYmd(d));
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return {
    fy,
    mm,
    yy: fy.slice(0, 2),
    periodKey: `${fy}_${mm}`,
  };
}

export function documentTypeFromPrefix(prefix) {
  const key = String(prefix || '').trim().toUpperCase();
  const legacyMap = {
    IN: 'client_invoice',
    PO: 'purchase_order',
    PI: 'proforma',
    QT: 'quotation',
    CN: 'credit_note',
    DN: 'debit_note',
    DC: 'delivery_challan',
    BS: 'bill_of_supply',
  };
  if (legacyMap[key]) return legacyMap[key];
  if (key === 'TYLO') return '';
  const suffix = Object.values(DOCUMENT_TYPE_SUFFIXES).find((s) => key.endsWith(s) && key.length > s.length);
  if (suffix && SUFFIX_TO_TYPE[suffix]) return SUFFIX_TO_TYPE[suffix];
  return Object.entries(DOCUMENT_NUMBER_PREFIXES).find(([, p]) => p === key)?.[0] || '';
}

export function documentCodeFromPrefix(prefix) {
  const key = String(prefix || '').trim().toUpperCase();
  const type = documentTypeFromPrefix(key);
  const suffix = type ? DOCUMENT_TYPE_SUFFIXES[type] : '';
  if (suffix && key.endsWith(suffix) && key.length > suffix.length) {
    return key.slice(0, -suffix.length);
  }
  return DEFAULT_DOCUMENT_CODE;
}

function formatCanonical(prefix, fy, mm, sequence) {
  return `${prefix}${fy}/${mm}/${String(sequence).padStart(SEQ_DIGITS, '0')}`;
}

export function parseDocumentNumber(value) {
  const text = String(value || '').trim().toUpperCase();
  const match = NUMBER_PATTERN.exec(text);
  if (match) {
    const documentCode = match[1];
    const suffix = match[2];
    const prefix = `${documentCode}${suffix}`;
    const fy = match[3];
    const mm = match[4] || '';
    const sequence = Number(match[5]);
    const documentType = SUFFIX_TO_TYPE[suffix] || '';
    if (!mm) {
      return {
        prefix,
        documentCode,
        documentType,
        fy,
        mm: '',
        sequence,
        periodKey: fy,
        normalized: `${prefix}${fy}/${String(sequence).padStart(4, '0')}`,
        fyOnly: true,
      };
    }
    return {
      prefix,
      documentCode,
      documentType,
      fy,
      mm,
      sequence,
      periodKey: `${fy}_${mm}`,
      normalized: formatCanonical(prefix, fy, mm, sequence),
    };
  }
  const short = SHORT_LEGACY_PATTERN.exec(text);
  if (short) {
    const prefix = short[1];
    const fy = short[2];
    const mm = short[3] || '';
    const sequence = Number(short[4]);
    if (!mm) {
      return {
        prefix,
        documentCode: DEFAULT_DOCUMENT_CODE,
        documentType: documentTypeFromPrefix(prefix),
        fy,
        mm: '',
        sequence,
        periodKey: fy,
        normalized: `${prefix}${fy}/${String(sequence).padStart(4, '0')}`,
        fyOnly: true,
      };
    }
    const canonicalPrefix = DOCUMENT_NUMBER_PREFIXES[documentTypeFromPrefix(prefix)] || prefix;
    return {
      prefix: canonicalPrefix,
      documentCode: documentCodeFromPrefix(canonicalPrefix),
      documentType: documentTypeFromPrefix(prefix),
      fy,
      mm,
      sequence,
      periodKey: `${fy}_${mm}`,
      normalized: formatCanonical(canonicalPrefix, fy, mm, sequence),
      legacy: true,
    };
  }
  const legacy = LEGACY_DASH_PATTERN.exec(text);
  if (legacy) {
    const prefix = legacy[1];
    const yy = legacy[2];
    const mm = legacy[3];
    const sequence = Number(legacy[4]);
    const fy = `${yy}-${String(Number(yy) + 1).padStart(2, '0')}`;
    return {
      prefix,
      documentCode: documentCodeFromPrefix(prefix),
      documentType: documentTypeFromPrefix(prefix),
      fy,
      mm,
      sequence,
      periodKey: `${fy}_${mm}`,
      normalized: formatCanonical(prefix, fy, mm, sequence),
      legacy: true,
    };
  }
  return null;
}

export function formatDocumentNumberExample(documentType, dateIso, documentCode = DEFAULT_DOCUMENT_CODE) {
  const prefix = prefixForDocumentType(documentType, documentCode);
  if (!prefix) return '';
  const { fy, mm } = documentNumberPeriod(dateIso);
  return formatCanonical(prefix, fy, mm, 1);
}

/**
 * Preserve historical Tylo (default + TC) counter keys so sequences do not restart.
 * Other orgs get an org-scoped counter.
 */
export function documentNumberCounterName(documentType, periodKey, { orgProfileId, documentCode } = {}) {
  const orgId = String(orgProfileId || 'default').trim() || 'default';
  const code = normalizeDocumentCode(documentCode);
  if (orgId === 'default' && code === DEFAULT_DOCUMENT_CODE) {
    return `financeDoc_${documentType}_${periodKey}`;
  }
  return `financeDoc_${orgId}_${documentType}_${periodKey}`;
}

/**
 * Assign next number for a document type: PREFIXFY/MM/SEQ (monthly sequence).
 */
export async function nextCommercialDocumentNumber(documentType, documentDate, options = {}) {
  const prefix = prefixForDocumentType(documentType, options.documentCode);
  if (!prefix) {
    throw new AppError(`Unknown document type for numbering: ${documentType}`, 400, 'VALIDATION_ERROR');
  }
  const { fy, mm, periodKey } = documentNumberPeriod(documentDate);
  const counterName = documentNumberCounterName(documentType, periodKey, options);
  const numberPrefix = `${prefix}${fy}/${mm}`;
  return nextSequence(counterName, numberPrefix, { separator: '/', digits: SEQ_DIGITS });
}

/**
 * Release an official document number so its monthly sequence can be reused.
 */
export async function releaseCommercialDocumentNumber(documentNumber, documentType, options = {}) {
  const parsed = parseDocumentNumber(documentNumber);
  if (!parsed || parsed.fyOnly || !parsed.mm || !(parsed.sequence > 0)) return false;
  const type = documentType || parsed.documentType;
  if (!type || !DOCUMENT_TYPE_SUFFIXES[type]) return false;
  const periodKey = parsed.periodKey || `${parsed.fy}_${parsed.mm}`;
  const counterName = documentNumberCounterName(type, periodKey, {
    orgProfileId: options.orgProfileId,
    documentCode: options.documentCode || parsed.documentCode,
  });
  return releaseSequence(counterName, parsed.sequence);
}

/**
 * Allow `{code}FY/MM/SEQ` (e.g. MR26-27/10/058) as shorthand for `{code}{IN|PO|…}FY/MM/SEQ`.
 */
export function coerceManualDocumentNumberInput(value, documentType, documentCode) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return text;
  if (parseDocumentNumber(text)) return text;
  const code = readExplicitDocumentCode(documentCode);
  const suffix = DOCUMENT_TYPE_SUFFIXES[documentType];
  if (!code || !suffix) return text;
  const bare = new RegExp(`^${code}(?:\\/)?(\\d{2}-\\d{2})\\/(\\d{2})\\/(\\d{3,})$`, 'i');
  const match = bare.exec(text);
  if (!match) return text;
  return `${code}${suffix}${match[1]}/${match[2]}/${match[3]}`;
}

export function validateManualDocumentNumber(value, documentType, options = {}) {
  const coerced = coerceManualDocumentNumberInput(value, documentType, options.documentCode);
  const parsed = parseDocumentNumber(coerced);
  const expectedPrefix = prefixForDocumentType(documentType, options.documentCode);
  const example = formatDocumentNumberExample(documentType, undefined, options.documentCode)
    || 'TCIN26-27/08/001';
  if (!parsed || parsed.fyOnly || !parsed.mm) {
    throw new AppError(
      `Document number must match PREFIXFY/MM/SEQ (e.g. ${example})`,
      400,
      'VALIDATION_ERROR',
    );
  }
  const typeFromParsed = parsed.documentType || documentTypeFromPrefix(parsed.prefix);
  if (expectedPrefix && typeFromParsed && typeFromParsed !== documentType) {
    throw new AppError(
      `Document number prefix must be ${expectedPrefix} for ${DOCUMENT_NUMBER_LABELS[documentType] || documentType}`,
      400,
      'VALIDATION_ERROR',
    );
  }
  if (expectedPrefix && parsed.prefix !== expectedPrefix) {
    throw new AppError(
      `Document number prefix must be ${expectedPrefix} for ${DOCUMENT_NUMBER_LABELS[documentType] || documentType}`,
      400,
      'VALIDATION_ERROR',
    );
  }
  return formatCanonical(expectedPrefix || parsed.prefix, parsed.fy, parsed.mm, parsed.sequence);
}
