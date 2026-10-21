import { AppError } from '../../utils/helpers.js';
import { nextSequence, releaseSequence } from '../../utils/counters.js';

/**
 * Standard commercial document numbering: PREFIXFY/MM/SEQ
 * Prefix = organisation documentCode + type suffix.
 * e.g. TCIN26-27/08/001 — Tylo Care (TC) Tax Invoice, FY 26-27, August, 1st of the month
 *
 * Suffixes:
 * IN Tax Invoice · PO Purchase Order · PI Proforma · QT Quotation
 * CN Credit Note · DN Debit Note · DC Delivery Challan · BS Bill of Supply
 *
 * Legacy PREFIX/FY/MM/SEQ (with slash after prefix) is still parsed for existing issued docs.
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

/** Default (Tylo Care) prefixes — used in examples and legacy docs. */
export const DOCUMENT_NUMBER_PREFIXES = Object.fromEntries(
  Object.entries(DOCUMENT_TYPE_SUFFIXES).map(([type, suffix]) => [
    type,
    `${DEFAULT_DOCUMENT_CODE}${suffix}`,
  ])
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
  })
);

const SUFFIX_TO_TYPE = Object.fromEntries(
  Object.entries(DOCUMENT_TYPE_SUFFIXES).map(([type, suffix]) => [suffix, type])
);

/** Current: TCIN26-27/08/001 — optional slash after prefix kept for legacy PREFIX/FY/... */
const NUMBER_PATTERN = /^([A-Z]{2,10})(?:\/)?(\d{2}-\d{2})(?:\/(\d{2}))?\/(\d{3,})$/i;
const LEGACY_DASH_PATTERN = /^(TCIN|TCPO|TCPI|TCCN)-(\d{2})-(\d{2})-(\d{3,})$/i;

const SEQ_DIGITS = 3;

/** 2–5 letters used as the org half of PREFIX (TC, MD, RD, TYLO). */
export function normalizeDocumentCode(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (raw.length < 2 || raw.length > 5) return '';
  return raw;
}

export function documentPrefix(documentType, documentCode = DEFAULT_DOCUMENT_CODE) {
  const suffix = DOCUMENT_TYPE_SUFFIXES[documentType];
  if (!suffix) return '';
  const code = normalizeDocumentCode(documentCode) || DEFAULT_DOCUMENT_CODE;
  return `${code}${suffix}`;
}

export function documentCodeFromPrefix(prefix) {
  const key = String(prefix || '').trim().toUpperCase();
  if (!key) return DEFAULT_DOCUMENT_CODE;
  const legacyMap = {
    IN: DEFAULT_DOCUMENT_CODE,
    PO: DEFAULT_DOCUMENT_CODE,
    PI: DEFAULT_DOCUMENT_CODE,
    QT: DEFAULT_DOCUMENT_CODE,
    CN: DEFAULT_DOCUMENT_CODE,
    DN: DEFAULT_DOCUMENT_CODE,
    DC: DEFAULT_DOCUMENT_CODE,
    BS: DEFAULT_DOCUMENT_CODE,
    TYLO: DEFAULT_DOCUMENT_CODE,
  };
  if (legacyMap[key]) return legacyMap[key];
  const suffix = key.slice(-2);
  if (SUFFIX_TO_TYPE[suffix] && key.length > 2) return key.slice(0, -2);
  return DEFAULT_DOCUMENT_CODE;
}

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
  const fromDefault = Object.entries(DOCUMENT_NUMBER_PREFIXES).find(([, p]) => p === key)?.[0];
  if (fromDefault) return fromDefault;
  const suffix = key.slice(-2);
  if (SUFFIX_TO_TYPE[suffix] && key.length > 2) return SUFFIX_TO_TYPE[suffix];
  return '';
}

function formatCanonical(prefix, fy, mm, sequence) {
  return `${prefix}${fy}/${mm}/${String(sequence).padStart(SEQ_DIGITS, '0')}`;
}

export function parseDocumentNumber(value) {
  const text = String(value || '').trim().toUpperCase();
  const match = NUMBER_PATTERN.exec(text);
  if (match) {
    const prefix = match[1];
    const fy = match[2];
    const mm = match[3] || '';
    const sequence = Number(match[4]);
    if (!mm) {
      return {
        prefix,
        documentType: documentTypeFromPrefix(prefix),
        documentCode: documentCodeFromPrefix(prefix),
        fy,
        mm: '',
        sequence,
        periodKey: fy,
        normalized: `${prefix}${fy}/${String(sequence).padStart(4, '0')}`,
        fyOnly: true,
      };
    }
    const type = documentTypeFromPrefix(prefix);
    const documentCode = documentCodeFromPrefix(prefix);
    const canonicalPrefix = type ? documentPrefix(type, documentCode) : prefix;
    return {
      prefix: canonicalPrefix,
      documentType: type,
      documentCode,
      fy,
      mm,
      sequence,
      periodKey: `${fy}_${mm}`,
      normalized: formatCanonical(canonicalPrefix, fy, mm, sequence),
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
      documentType: documentTypeFromPrefix(prefix),
      documentCode: documentCodeFromPrefix(prefix),
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
  const prefix = documentPrefix(documentType, documentCode);
  if (!prefix) return '';
  const { fy, mm } = documentNumberPeriod(dateIso);
  return formatCanonical(prefix, fy, mm, 1);
}

function counterNameFor(documentType, periodKey, documentCode) {
  const code = normalizeDocumentCode(documentCode) || DEFAULT_DOCUMENT_CODE;
  // Tylo Care (TC) keeps the original counter so existing sequences continue.
  if (code === DEFAULT_DOCUMENT_CODE) return `financeDoc_${documentType}_${periodKey}`;
  return `financeDoc_${documentType}_${code}_${periodKey}`;
}

/**
 * Assign next number for a document type: PREFIXFY/MM/SEQ (monthly sequence per org code).
 */
export async function nextCommercialDocumentNumber(documentType, documentDate, options = {}) {
  const documentCode = normalizeDocumentCode(options.documentCode) || DEFAULT_DOCUMENT_CODE;
  const prefix = documentPrefix(documentType, documentCode);
  if (!prefix) {
    throw new AppError(`Unknown document type for numbering: ${documentType}`, 400, 'VALIDATION_ERROR');
  }
  const { fy, mm, periodKey } = documentNumberPeriod(documentDate);
  const counterName = counterNameFor(documentType, periodKey, documentCode);
  const numberPrefix = `${prefix}${fy}/${mm}`;
  return nextSequence(counterName, numberPrefix, { separator: '/', digits: SEQ_DIGITS });
}

/**
 * Release an official document number so its monthly sequence can be reused.
 */
export async function releaseCommercialDocumentNumber(documentNumber, documentType) {
  const parsed = parseDocumentNumber(documentNumber);
  if (!parsed || parsed.fyOnly || !parsed.mm || !(parsed.sequence > 0)) return false;
  const type = documentType || parsed.documentType;
  if (!type || !DOCUMENT_TYPE_SUFFIXES[type]) return false;
  const periodKey = parsed.periodKey || `${parsed.fy}_${parsed.mm}`;
  const counterName = counterNameFor(type, periodKey, parsed.documentCode);
  return releaseSequence(counterName, parsed.sequence);
}

export function validateManualDocumentNumber(value, documentType, options = {}) {
  const parsed = parseDocumentNumber(value);
  const documentCode = normalizeDocumentCode(options.documentCode) || DEFAULT_DOCUMENT_CODE;
  const expectedPrefix = documentPrefix(documentType, documentCode);
  const example = formatDocumentNumberExample(documentType, null, documentCode) || 'TCIN26-27/08/001';
  if (!parsed || parsed.fyOnly || !parsed.mm) {
    throw new AppError(
      `Document number must match PREFIXFY/MM/SEQ (e.g. ${example})`,
      400,
      'VALIDATION_ERROR'
    );
  }
  const typeFromParsed = parsed.documentType || documentTypeFromPrefix(parsed.prefix);
  if (documentType && typeFromParsed && typeFromParsed !== documentType) {
    throw new AppError(
      `Document number prefix must be ${expectedPrefix} for ${DOCUMENT_NUMBER_LABELS[documentType] || documentType}`,
      400,
      'VALIDATION_ERROR'
    );
  }
  if (expectedPrefix && parsed.prefix !== expectedPrefix) {
    throw new AppError(
      `Document number prefix must be ${expectedPrefix} for ${DOCUMENT_NUMBER_LABELS[documentType] || documentType}`,
      400,
      'VALIDATION_ERROR'
    );
  }
  return formatCanonical(expectedPrefix || parsed.prefix, parsed.fy, parsed.mm, parsed.sequence);
}

export function normalizeDocumentNumberKey(value) {
  const parsed = parseDocumentNumber(value);
  if (parsed?.normalized) return parsed.normalized.toUpperCase();
  return String(value || '').trim().toUpperCase();
}

/** Corrected numbers stay reserved — they are not released for reuse. */
export function historyHoldsDocumentNumber(history, value) {
  const key = normalizeDocumentNumberKey(value);
  if (!key || !Array.isArray(history)) return false;
  return history.some((entry) => {
    const from = normalizeDocumentNumberKey(entry?.from);
    const to = normalizeDocumentNumberKey(entry?.to);
    return from === key || to === key;
  });
}
