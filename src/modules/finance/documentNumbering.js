import { AppError } from '../../utils/helpers.js';
import { nextSequence, releaseSequence } from '../../utils/counters.js';

/**
 * Standard commercial document numbering: PREFIX/FY/MM/SEQ
 * e.g. TCIN/26-27/08/001 — Tax Invoice, FY 26-27, August, 1st of the month
 *
 * TCIN – Tax Invoice
 * TCPO – Purchase Order
 * TCPI – Proforma Invoice
 * TCQT – Quotation
 * TCCN – Credit Note
 * TCDN – Debit Note
 * TCDC – Delivery Challan
 * TCBS – Bill of Supply
 */
export const DOCUMENT_NUMBER_PREFIXES = {
  client_invoice: 'TCIN',
  purchase_order: 'TCPO',
  proforma: 'TCPI',
  quotation: 'TCQT',
  credit_note: 'TCCN',
  debit_note: 'TCDN',
  delivery_challan: 'TCDC',
  bill_of_supply: 'TCBS',
};

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
    example: `${prefix}/26-27/08/001`,
  })
);

const NUMBER_PATTERN =
  /^(TCIN|TCPO|TCPI|TCQT|TCCN|TCDN|TCDC|TCBS|IN|PO|PI|CN|DN|DC|BS|TYLO|QT)\/(\d{2}-\d{2})(?:\/(\d{2}))?\/(\d{3,})$/i;
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
  return Object.entries(DOCUMENT_NUMBER_PREFIXES).find(([, p]) => p === key)?.[0] || '';
}

function formatCanonical(prefix, fy, mm, sequence) {
  return `${prefix}/${fy}/${mm}/${String(sequence).padStart(SEQ_DIGITS, '0')}`;
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
        fy,
        mm: '',
        sequence,
        periodKey: fy,
        normalized: `${prefix}/${fy}/${String(sequence).padStart(4, '0')}`,
        fyOnly: true,
      };
    }
    const canonicalPrefix = DOCUMENT_NUMBER_PREFIXES[documentTypeFromPrefix(prefix)] || prefix;
    return {
      prefix: canonicalPrefix,
      documentType: documentTypeFromPrefix(prefix),
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

export function formatDocumentNumberExample(documentType, dateIso) {
  const prefix = DOCUMENT_NUMBER_PREFIXES[documentType];
  if (!prefix) return '';
  const { fy, mm } = documentNumberPeriod(dateIso);
  return formatCanonical(prefix, fy, mm, 1);
}

/**
 * Assign next number for a document type: PREFIX/FY/MM/SEQ (monthly sequence).
 */
export async function nextCommercialDocumentNumber(documentType, documentDate) {
  const prefix = DOCUMENT_NUMBER_PREFIXES[documentType];
  if (!prefix) {
    throw new AppError(`Unknown document type for numbering: ${documentType}`, 400, 'VALIDATION_ERROR');
  }
  const { fy, mm, periodKey } = documentNumberPeriod(documentDate);
  const counterName = `financeDoc_${documentType}_${periodKey}`;
  const numberPrefix = `${prefix}/${fy}/${mm}`;
  return nextSequence(counterName, numberPrefix, { separator: '/', digits: SEQ_DIGITS });
}

/**
 * Release an official document number so its monthly sequence can be reused.
 */
export async function releaseCommercialDocumentNumber(documentNumber, documentType) {
  const parsed = parseDocumentNumber(documentNumber);
  if (!parsed || parsed.fyOnly || !parsed.mm || !(parsed.sequence > 0)) return false;
  const type = documentType || parsed.documentType;
  if (!type || !DOCUMENT_NUMBER_PREFIXES[type]) return false;
  const periodKey = parsed.periodKey || `${parsed.fy}_${parsed.mm}`;
  const counterName = `financeDoc_${type}_${periodKey}`;
  return releaseSequence(counterName, parsed.sequence);
}

export function validateManualDocumentNumber(value, documentType) {
  const parsed = parseDocumentNumber(value);
  const expectedPrefix = DOCUMENT_NUMBER_PREFIXES[documentType];
  const example = formatDocumentNumberExample(documentType) || 'TCIN/26-27/08/001';
  if (!parsed || parsed.fyOnly || !parsed.mm) {
    throw new AppError(
      `Document number must match PREFIX/FY/MM/SEQ (e.g. ${example})`,
      400,
      'VALIDATION_ERROR'
    );
  }
  const typeFromParsed = parsed.documentType || documentTypeFromPrefix(parsed.prefix);
  if (expectedPrefix && typeFromParsed && typeFromParsed !== documentType) {
    throw new AppError(
      `Document number prefix must be ${expectedPrefix} for ${DOCUMENT_NUMBER_LABELS[documentType] || documentType}`,
      400,
      'VALIDATION_ERROR'
    );
  }
  if (expectedPrefix && !typeFromParsed && parsed.prefix !== expectedPrefix) {
    throw new AppError(
      `Document number prefix must be ${expectedPrefix} for ${DOCUMENT_NUMBER_LABELS[documentType] || documentType}`,
      400,
      'VALIDATION_ERROR'
    );
  }
  return formatCanonical(expectedPrefix || parsed.prefix, parsed.fy, parsed.mm, parsed.sequence);
}
