import { AppError } from '../../utils/helpers.js';
import { nextSequence } from '../../utils/counters.js';

/**
 * Standard commercial document numbering: PREFIX/FY/MM/SEQ
 * e.g. IN/26-27/08/0002 — Tax Invoice, FY 26-27, August, 2nd of the month
 *
 * PO – Purchase Order
 * PI – Proforma Invoice
 * IN – Tax Invoice
 * CN – Credit Note
 * DN – Debit Note
 */
export const DOCUMENT_NUMBER_PREFIXES = {
  client_invoice: 'IN',
  purchase_order: 'PO',
  proforma: 'PI',
  credit_note: 'CN',
  debit_note: 'DN',
};

export const DOCUMENT_NUMBER_LABELS = {
  client_invoice: 'Tax Invoice',
  purchase_order: 'Purchase Order',
  proforma: 'Proforma Invoice',
  credit_note: 'Credit Note',
  debit_note: 'Debit Note',
};

/** Human-readable standards for UI / API meta */
export const DOCUMENT_NUMBER_STANDARDS = [
  { documentType: 'purchase_order', prefix: 'PO', label: 'Purchase Order', example: 'PO/26-27/08/0001' },
  { documentType: 'proforma', prefix: 'PI', label: 'Proforma Invoice', example: 'PI/26-27/08/0001' },
  { documentType: 'client_invoice', prefix: 'IN', label: 'Tax Invoice', example: 'IN/26-27/08/0002' },
  { documentType: 'credit_note', prefix: 'CN', label: 'Credit Note', example: 'CN/26-27/08/0001' },
  { documentType: 'debit_note', prefix: 'DN', label: 'Debit Note', example: 'DN/26-27/08/0001' },
];

const NUMBER_PATTERN = /^(IN|PO|PI|CN|DN)\/(\d{2}-\d{2})\/(\d{2})\/(\d{3,})$/i;
const LEGACY_NUMBER_PATTERN = /^(TCIN|TCPO|TCPI|TCCN)-(\d{2})-(\d{2})-(\d{3,})$/i;

/** Indian FY label e.g. 26-27 for dates in Apr 2026 – Mar 2027 */
export function fiscalYearLabel(dateIso) {
  const d = parseDate(dateIso);
  const month = d.getMonth(); // 0-based
  const year = d.getFullYear();
  const startYear = month >= 3 ? year : year - 1;
  const endShort = String(startYear + 1).slice(-2);
  return `${String(startYear).slice(-2)}-${endShort}`;
}

function parseDate(dateIso) {
  if (!dateIso) return new Date();
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
  const fy = fiscalYearLabel(d.toISOString().slice(0, 10));
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
  return Object.entries(DOCUMENT_NUMBER_PREFIXES).find(([, p]) => p === key)?.[0] || '';
}

export function parseDocumentNumber(value) {
  const text = String(value || '').trim().toUpperCase();
  const match = NUMBER_PATTERN.exec(text);
  if (match) {
    return {
      prefix: match[1],
      documentType: documentTypeFromPrefix(match[1]),
      fy: match[2],
      mm: match[3],
      sequence: Number(match[4]),
      periodKey: `${match[2]}_${match[3]}`,
      normalized: `${match[1]}/${match[2]}/${match[3]}/${String(match[4]).padStart(4, '0')}`,
    };
  }
  const legacy = LEGACY_NUMBER_PATTERN.exec(text);
  if (legacy) {
    const legacyMap = { TCIN: 'IN', TCPO: 'PO', TCPI: 'PI', TCCN: 'CN' };
    const prefix = legacyMap[legacy[1]] || legacy[1];
    return {
      prefix,
      documentType: documentTypeFromPrefix(prefix),
      fy: '',
      mm: legacy[3],
      sequence: Number(legacy[4]),
      periodKey: `${legacy[2]}-${legacy[3]}`,
      normalized: text,
      legacy: true,
    };
  }
  return null;
}

export function formatDocumentNumberExample(documentType, dateIso) {
  const prefix = DOCUMENT_NUMBER_PREFIXES[documentType];
  if (!prefix) return '';
  const { fy, mm } = documentNumberPeriod(dateIso);
  return `${prefix}/${fy}/${mm}/0001`;
}

/**
 * Assign next number for a document type in the FY+month period of documentDate.
 * Example: IN/26-27/08/0002
 */
export async function nextCommercialDocumentNumber(documentType, documentDate) {
  const prefix = DOCUMENT_NUMBER_PREFIXES[documentType];
  if (!prefix) {
    throw new AppError(`Unknown document type for numbering: ${documentType}`, 400, 'VALIDATION_ERROR');
  }
  const { fy, mm, periodKey } = documentNumberPeriod(documentDate);
  const counterName = `financeDoc_${documentType}_${periodKey}`;
  const numberPrefix = `${prefix}/${fy}/${mm}`;
  return nextSequence(counterName, numberPrefix, { separator: '/', digits: 4 });
}

export function validateManualDocumentNumber(value, documentType) {
  const parsed = parseDocumentNumber(value);
  if (!parsed || parsed.legacy) {
    throw new AppError(
      'Document number must match PREFIX/FY/MM/0001 (e.g. IN/26-27/08/0002)',
      400,
      'VALIDATION_ERROR'
    );
  }
  const expectedPrefix = DOCUMENT_NUMBER_PREFIXES[documentType];
  if (expectedPrefix && parsed.prefix !== expectedPrefix) {
    throw new AppError(
      `Document number prefix must be ${expectedPrefix} for ${DOCUMENT_NUMBER_LABELS[documentType] || documentType}`,
      400,
      'VALIDATION_ERROR'
    );
  }
  return parsed.normalized;
}
