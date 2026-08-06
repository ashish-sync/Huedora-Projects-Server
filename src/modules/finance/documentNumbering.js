import { AppError } from '../../utils/helpers.js';
import { nextSequence } from '../../utils/counters.js';

/**
 * Standard commercial document numbering:
 * TYLO/FY/SEQ — Tax Invoice, Quotation, Proforma, Credit/Debit Note, Bill of Supply
 * PO/FY/SEQ — Purchase Order
 * DC/FY/SEQ — Delivery Challan
 * Legacy monthly: PREFIX/FY/MM/SEQ (still accepted for older IN numbers)
 */
export const DOCUMENT_NUMBER_PREFIXES = {
  client_invoice: 'TYLO',
  purchase_order: 'PO',
  proforma: 'TYLO',
  quotation: 'TYLO',
  credit_note: 'TYLO',
  debit_note: 'TYLO',
  delivery_challan: 'DC',
  bill_of_supply: 'TYLO',
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
export const DOCUMENT_NUMBER_STANDARDS = [
  { documentType: 'purchase_order', prefix: 'PO', label: 'Purchase Order', example: 'PO/26-27/0001' },
  { documentType: 'quotation', prefix: 'TYLO', label: 'Quotation', example: 'TYLO/26-27/0001' },
  { documentType: 'proforma', prefix: 'TYLO', label: 'Proforma Invoice', example: 'TYLO/26-27/0001' },
  { documentType: 'client_invoice', prefix: 'TYLO', label: 'Tax Invoice', example: 'TYLO/26-27/0001' },
  { documentType: 'credit_note', prefix: 'TYLO', label: 'Credit Note', example: 'TYLO/26-27/0001' },
  { documentType: 'debit_note', prefix: 'TYLO', label: 'Debit Note', example: 'TYLO/26-27/0001' },
  { documentType: 'delivery_challan', prefix: 'DC', label: 'Delivery Challan', example: 'DC/26-27/0001' },
  { documentType: 'bill_of_supply', prefix: 'TYLO', label: 'Bill of Supply', example: 'TYLO/26-27/0001' },
];

const NUMBER_PATTERN = /^(IN|PO|PI|CN|DN|DC|BS|TYLO)\/(\d{2}-\d{2})(?:\/(\d{2}))?\/(\d{3,})$/i;
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
  // TYLO / BS are shared brand prefixes used by multiple document types.
  if (key === 'BS' || key === 'TYLO') return '';
  return Object.entries(DOCUMENT_NUMBER_PREFIXES).find(([, p]) => p === key)?.[0] || '';
}

export function parseDocumentNumber(value) {
  const text = String(value || '').trim().toUpperCase();
  const match = NUMBER_PATTERN.exec(text);
  if (match) {
    const prefix = match[1];
    const fy = match[2];
    const mm = match[3] || '';
    const sequence = Number(match[4]);
    const isFyOnly =
      !mm &&
      (prefix === 'TYLO' || prefix === 'BS' || prefix === 'CN' || prefix === 'DN' || prefix === 'DC' || prefix === 'PO');
    return {
      prefix,
      documentType: documentTypeFromPrefix(prefix),
      fy,
      mm,
      sequence,
      periodKey: isFyOnly ? fy : `${fy}_${mm}`,
      normalized: isFyOnly
        ? `${prefix}/${fy}/${String(sequence).padStart(4, '0')}`
        : `${prefix}/${fy}/${mm}/${String(sequence).padStart(4, '0')}`,
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
  if (
    documentType === 'bill_of_supply' ||
    documentType === 'credit_note' ||
    documentType === 'debit_note' ||
    documentType === 'proforma' ||
    documentType === 'quotation' ||
    documentType === 'client_invoice' ||
    documentType === 'delivery_challan' ||
    documentType === 'purchase_order'
  ) {
    return `${prefix}/${fy}/0001`;
  }
  return `${prefix}/${fy}/${mm}/0001`;
}

/**
 * Assign next number for a document type.
 * Shared TYLO/FY/SEQ for Tax Invoice, Quotation, Proforma, Credit/Debit Note, Bill of Supply.
 */
export async function nextCommercialDocumentNumber(documentType, documentDate) {
  const prefix = DOCUMENT_NUMBER_PREFIXES[documentType];
  if (!prefix) {
    throw new AppError(`Unknown document type for numbering: ${documentType}`, 400, 'VALIDATION_ERROR');
  }
  const { fy, mm, periodKey } = documentNumberPeriod(documentDate);
  if (
    documentType === 'bill_of_supply' ||
    documentType === 'credit_note' ||
    documentType === 'debit_note' ||
    documentType === 'proforma' ||
    documentType === 'quotation' ||
    documentType === 'client_invoice'
  ) {
    const counterName = `financeDoc_tylo_${fy}`;
    return nextSequence(counterName, `TYLO/${fy}`, { separator: '/', digits: 4 });
  }
  if (documentType === 'delivery_challan') {
    const counterName = `financeDoc_delivery_challan_${fy}`;
    return nextSequence(counterName, `DC/${fy}`, { separator: '/', digits: 4 });
  }
  if (documentType === 'purchase_order') {
    const counterName = `financeDoc_purchase_order_${fy}`;
    return nextSequence(counterName, `PO/${fy}`, { separator: '/', digits: 4 });
  }
  const counterName = `financeDoc_${documentType}_${periodKey}`;
  const numberPrefix = `${prefix}/${fy}/${mm}`;
  return nextSequence(counterName, numberPrefix, { separator: '/', digits: 4 });
}

export function validateManualDocumentNumber(value, documentType) {
  const parsed = parseDocumentNumber(value);
  const fyOnlyStyle =
    documentType === 'bill_of_supply' ||
    documentType === 'credit_note' ||
    documentType === 'debit_note' ||
    documentType === 'proforma' ||
    documentType === 'quotation' ||
    documentType === 'client_invoice' ||
    documentType === 'delivery_challan' ||
    documentType === 'purchase_order';
  const fyOnlyMessage =
    documentType === 'delivery_challan'
      ? 'Document number must match DC/FY/0001 (e.g. DC/26-27/0001)'
      : documentType === 'purchase_order'
        ? 'Document number must match PO/FY/0001 (e.g. PO/26-27/0001)'
        : 'Document number must match TYLO/FY/0001 (e.g. TYLO/26-27/0001)';
  if (!parsed || parsed.legacy) {
    throw new AppError(
      fyOnlyStyle ? fyOnlyMessage : 'Document number must match PREFIX/FY/MM/0001 (e.g. IN/26-27/08/0002)',
      400,
      'VALIDATION_ERROR'
    );
  }
  if (fyOnlyStyle && parsed.mm) {
    throw new AppError(fyOnlyMessage, 400, 'VALIDATION_ERROR');
  }
  if (!fyOnlyStyle && !parsed.mm) {
    throw new AppError(
      'Document number must match PREFIX/FY/MM/0001 (e.g. IN/26-27/08/0002)',
      400,
      'VALIDATION_ERROR'
    );
  }
  const expectedPrefix = DOCUMENT_NUMBER_PREFIXES[documentType];
  const prefixOk =
    expectedPrefix &&
    (parsed.prefix === expectedPrefix ||
      ((documentType === 'bill_of_supply' ||
        documentType === 'credit_note' ||
        documentType === 'debit_note' ||
        documentType === 'proforma' ||
        documentType === 'quotation' ||
        documentType === 'client_invoice') &&
        (parsed.prefix === 'TYLO' ||
          parsed.prefix === 'BS' ||
          parsed.prefix === 'CN' ||
          parsed.prefix === 'DN' ||
          parsed.prefix === 'PI' ||
          parsed.prefix === 'QT' ||
          parsed.prefix === 'IN')));
  if (expectedPrefix && !prefixOk) {
    throw new AppError(
      `Document number prefix must be ${expectedPrefix} for ${DOCUMENT_NUMBER_LABELS[documentType] || documentType}`,
      400,
      'VALIDATION_ERROR'
    );
  }
  return parsed.normalized;
}
