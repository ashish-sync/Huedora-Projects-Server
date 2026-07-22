import { AppError } from '../../utils/helpers.js';
import { nextSequence } from '../../utils/counters.js';

/**
 * Standard commercial document numbering: PREFIX-YY-MM-SEQ
 * e.g. TCPI-26-07-001
 */
export const DOCUMENT_NUMBER_PREFIXES = {
  client_invoice: 'TCI',
  purchase_order: 'TCPO',
  proforma: 'TCPI',
  credit_note: 'TCCN',
};

export const DOCUMENT_NUMBER_LABELS = {
  client_invoice: 'Invoice',
  purchase_order: 'Purchase Order',
  proforma: 'Proforma Invoice',
  credit_note: 'Credit Note',
};

/** Human-readable standards for UI / API meta */
export const DOCUMENT_NUMBER_STANDARDS = [
  { documentType: 'client_invoice', prefix: 'TCI', label: 'Invoice', example: 'TCI-26-07-001' },
  { documentType: 'purchase_order', prefix: 'TCPO', label: 'Purchase Order', example: 'TCPO-26-07-001' },
  { documentType: 'proforma', prefix: 'TCPI', label: 'Proforma Invoice', example: 'TCPI-26-07-001' },
  { documentType: 'credit_note', prefix: 'TCCN', label: 'Credit Note', example: 'TCCN-26-07-001' },
];

const NUMBER_PATTERN = /^(TCI|TCPO|TCPI|TCCN)-(\d{2})-(\d{2})-(\d{3,})$/;

export function documentNumberPeriod(dateIso) {
  const d = dateIso ? new Date(dateIso) : new Date();
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return {
      yy: String(now.getFullYear()).slice(-2),
      mm: String(now.getMonth() + 1).padStart(2, '0'),
      periodKey: `${String(now.getFullYear()).slice(-2)}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    };
  }
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return { yy, mm, periodKey: `${yy}-${mm}` };
}

export function documentTypeFromPrefix(prefix) {
  const key = String(prefix || '').trim().toUpperCase();
  return Object.entries(DOCUMENT_NUMBER_PREFIXES).find(([, p]) => p === key)?.[0] || '';
}

export function parseDocumentNumber(value) {
  const text = String(value || '').trim().toUpperCase();
  const match = NUMBER_PATTERN.exec(text);
  if (!match) return null;
  return {
    prefix: match[1],
    documentType: documentTypeFromPrefix(match[1]),
    yy: match[2],
    mm: match[3],
    sequence: Number(match[4]),
    periodKey: `${match[2]}-${match[3]}`,
    normalized: `${match[1]}-${match[2]}-${match[3]}-${String(match[4]).padStart(3, '0')}`,
  };
}

export function formatDocumentNumberExample(documentType, dateIso) {
  const prefix = DOCUMENT_NUMBER_PREFIXES[documentType];
  if (!prefix) return '';
  const { yy, mm } = documentNumberPeriod(dateIso);
  return `${prefix}-${yy}-${mm}-001`;
}

/**
 * Assign next number for a document type in the YY-MM period of documentDate.
 */
export async function nextCommercialDocumentNumber(documentType, documentDate) {
  const prefix = DOCUMENT_NUMBER_PREFIXES[documentType];
  if (!prefix) {
    throw new AppError(`Unknown document type for numbering: ${documentType}`, 400, 'VALIDATION_ERROR');
  }
  const { yy, mm, periodKey } = documentNumberPeriod(documentDate);
  const counterName = `financeDoc_${documentType}_${periodKey}`;
  const numberPrefix = `${prefix}-${yy}-${mm}`;
  return nextSequence(counterName, numberPrefix, { separator: '-', digits: 3 });
}

export function validateManualDocumentNumber(value, documentType) {
  const parsed = parseDocumentNumber(value);
  if (!parsed) {
    throw new AppError(
      'Document number must match PREFIX-YY-MM-001 (e.g. TCPI-26-07-001)',
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
