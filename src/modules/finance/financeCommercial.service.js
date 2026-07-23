import { AppError } from '../../utils/helpers.js';
import {
  COMMERCIAL_DOC_STATUSES,
  DEFAULT_ORG_PROFILE,
  DEFAULT_SAC_CODE,
} from './finance.constants.js';
import {
  documentNumberPeriod,
} from './documentNumbering.js';
import { FinanceOrgProfile } from './finance.model.js';

export function trimStr(v) {
  return v == null ? '' : String(v).trim();
}

export function toAmount(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Indian FY label e.g. 26-27 for dates in Apr 2026 – Mar 2027 */
export function fiscalYearLabel(dateIso) {
  const d = dateIso ? new Date(dateIso) : new Date();
  const month = d.getMonth();
  const year = d.getFullYear();
  const startYear = month >= 3 ? year : year - 1;
  const endShort = String(startYear + 1).slice(-2);
  return `${String(startYear).slice(-2)}-${endShort}`;
}

export function formatDisplayDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return String(iso);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** e.g. 09-01-2026 for ERP document headers */
export function formatDisplayDateErp(iso) {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return formatDisplayDate(iso);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** e.g. 05 Aug 2024 for proforma PDF header */
export function formatDisplayDateLong(iso) {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return formatDisplayDate(iso);
  const day = String(Number(m[3])).padStart(2, '0');
  const month = MONTHS[Number(m[2]) - 1] || m[2];
  return `${day} ${month} ${m[1]}`;
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${TENS[t]}${o ? ` ${ONES[o]}` : ''}`.trim();
}

function threeDigits(n) {
  if (n < 100) return twoDigits(n);
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return `${ONES[h]} Hundred${rest ? ` ${twoDigits(rest)}` : ''}`;
}

export function amountInWordsIndian(amount) {
  const value = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(value) || value === 0) return 'Zero Only';

  const rupees = Math.floor(Math.abs(value));
  const paise = Math.round((Math.abs(value) - rupees) * 100);

  const parts = [];
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const hundred = rupees % 1000;

  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));

  let words = parts.join(' ').trim() || 'Zero';
  if (paise) words += ` and ${twoDigits(paise)} Paise`;
  return `${words} Only`;
}

export function usesIgst(recipientStateCode, orgStateCode) {
  const r = trimStr(recipientStateCode);
  const o = trimStr(orgStateCode);
  if (!r || !o) return true;
  return r !== o;
}

export function normalizeLineItem(raw = {}, index = 0, taxMode = 'igst') {
  const qty = toAmount(raw.qty) || 0;
  const rate = toAmount(raw.rate) || 0;
  const discount = toAmount(raw.discount) || 0;
  let amount = raw.amount != null && raw.amount !== '' ? toAmount(raw.amount) : qty * rate - discount;
  if (amount < 0) amount = 0;
  const taxableAmount = toAmount(raw.taxableAmount) || amount;
  const igstRate = toAmount(raw.igstRate) || 0;
  const cgstRate = toAmount(raw.cgstRate) || 0;
  const sgstRate = toAmount(raw.sgstRate) || 0;

  let igstAmount = 0;
  let cgstAmount = 0;
  let sgstAmount = 0;
  if (taxMode === 'igst') {
    igstAmount = Math.round((taxableAmount * igstRate) / 100 * 100) / 100;
  } else {
    cgstAmount = Math.round((taxableAmount * cgstRate) / 100 * 100) / 100;
    sgstAmount = Math.round((taxableAmount * sgstRate) / 100 * 100) / 100;
  }

  const totalAmount =
    raw.totalAmount != null && raw.totalAmount !== ''
      ? toAmount(raw.totalAmount)
      : Math.round((taxableAmount + igstAmount + cgstAmount + sgstAmount) * 100) / 100;

  return {
    sectionTitle: trimStr(raw.sectionTitle),
    description: trimStr(raw.description),
    sacCode: trimStr(raw.sacCode) || DEFAULT_SAC_CODE,
    qty,
    rate,
    amount,
    discount,
    taxableAmount,
    igstRate,
    igstAmount,
    cgstRate,
    cgstAmount,
    sgstRate,
    sgstAmount,
    totalAmount,
    sortOrder: Number(raw.sortOrder) || index + 1,
  };
}

export function computeDocumentTotals(lineItems = [], adjustments = {}) {
  const subtotal = lineItems.reduce((s, row) => s + (Number(row.taxableAmount) || 0), 0);
  const taxAmount = lineItems.reduce(
    (s, row) =>
      s + (Number(row.igstAmount) || 0) + (Number(row.cgstAmount) || 0) + (Number(row.sgstAmount) || 0),
    0
  );
  const cnAmount = toAmount(adjustments.cnAmount);
  const dnAmount = toAmount(adjustments.dnAmount);
  const advanceReceived = toAmount(adjustments.advanceReceived);
  const rawTotal = subtotal + taxAmount + dnAmount - cnAmount - advanceReceived;
  const rounded = Math.round(rawTotal);
  const roundOff = Math.round((rounded - rawTotal) * 100) / 100;
  const grandTotal = Math.round((rawTotal + roundOff) * 100) / 100;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    cnAmount,
    dnAmount,
    advanceReceived,
    roundOff,
    grandTotal,
    amountInWords: amountInWordsIndian(grandTotal),
  };
}

export async function getOrCreateOrgProfile() {
  let row = await FinanceOrgProfile.findOne({ _id: 'default' });
  if (!row) {
    row = await FinanceOrgProfile.create({ _id: 'default', ...DEFAULT_ORG_PROFILE });
  }
  return row;
}

export function mergeOrgProfile(body = {}) {
  const fields = [
    'legalName',
    'brandLine',
    'cin',
    'pan',
    'gstin',
    'state',
    'stateCode',
    'registeredOffice',
    'phone',
    'email',
    'website',
    'bankName',
    'accountNumber',
    'ifscCode',
    'bankBranch',
    'defaultPaymentTermsDays',
    'defaultTerms',
    'proformaNotes',
    'defaultPoTerms',
    'defaultPurchaseTaxRate',
  ];
  const out = {};
  for (const key of fields) {
    if (body[key] !== undefined) {
      out[key] =
        key === 'defaultTerms' || key === 'proformaNotes' || key === 'defaultPoTerms'
          ? Array.isArray(body[key])
            ? body[key].map((t) => String(t).trim()).filter(Boolean)
            : String(body[key] || '')
                .split('\n')
                .map((t) => t.trim())
                .filter(Boolean)
          : key === 'defaultPaymentTermsDays' || key === 'defaultPurchaseTaxRate'
            ? Number(body[key]) || 0
            : trimStr(body[key]);
    }
  }
  return out;
}

export { nextCommercialDocumentNumber as nextProformaNumber } from './documentNumbering.js';
export { nextCommercialDocumentNumber as nextPurchaseOrderNumber } from './documentNumbering.js';

export function normalizePoLineItem(raw = {}, index = 0) {
  const isFoc = Boolean(raw.isFoc);
  const qty = toAmount(raw.qty) || 0;
  const rate = isFoc ? 0 : toAmount(raw.rate) || 0;
  const amount =
    raw.amount != null && raw.amount !== ''
      ? toAmount(raw.amount)
      : Math.round(qty * rate * 100) / 100;
  return {
    description: trimStr(raw.description),
    qty,
    rate,
    amount,
    isFoc,
    sortOrder: Number(raw.sortOrder) || index + 1,
  };
}

export function computePurchaseOrderTotals(lineItems = [], purchaseTaxRate = 5, roundOff = 0) {
  const subtotal = lineItems.reduce((s, row) => s + (Number(row.amount) || 0), 0);
  const rate = toAmount(purchaseTaxRate);
  const taxAmount = Math.round((subtotal * rate) / 100 * 100) / 100;
  const rawTotal = subtotal + taxAmount + toAmount(roundOff);
  const grandTotal = Math.round(rawTotal * 100) / 100;
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxAmount,
    purchaseTaxRate: rate,
    roundOff: toAmount(roundOff),
    grandTotal,
    amountInWords: amountInWordsIndian(grandTotal),
  };
}

export function normalizePurchaseOrderPayload(body = {}, orgProfile = DEFAULT_ORG_PROFILE) {
  const documentDate = trimStr(body.documentDate) || todayIso();
  const period = documentNumberPeriod(documentDate);
  const rawLines = Array.isArray(body.lineItems) ? body.lineItems : [];
  const lineItems = rawLines
    .filter((row) => trimStr(row.description))
    .map((row, index) => normalizePoLineItem(row, index));

  const purchaseTaxRate =
    body.purchaseTaxRate != null && body.purchaseTaxRate !== ''
      ? toAmount(body.purchaseTaxRate)
      : Number(orgProfile.defaultPurchaseTaxRate) || 5;

  const totals = computePurchaseOrderTotals(lineItems, purchaseTaxRate, body.roundOff);

  const terms = Array.isArray(body.terms)
    ? body.terms.map((t) => String(t).trim()).filter(Boolean)
    : trimStr(body.terms)
      ? String(body.terms)
          .split('\n')
          .map((t) => t.trim())
          .filter(Boolean)
      : [...(orgProfile.defaultPoTerms || DEFAULT_ORG_PROFILE.defaultPoTerms || [])];

  return {
    documentType: 'purchase_order',
    documentDate,
    dueDate: trimStr(body.dueDate),
    fiscalYear: fiscalYearLabel(documentDate),
    documentPeriod: period.periodKey,
    contactId: body.contactId || null,
    recipientName: trimStr(body.vendorName || body.recipientName),
    placeOfSupply: trimStr(body.vendorAddress || body.placeOfSupply),
    contactPerson: trimStr(body.contactPerson),
    contactEmail: trimStr(body.contactEmail),
    recipientGstin: trimStr(body.vendorGstin || body.recipientGstin),
    projectName: trimStr(body.reference || body.projectName),
    lineItems,
    terms,
    customNotes: trimStr(body.notes || body.customNotes),
    ...totals,
  };
}

export function validatePurchaseOrderPayload(payload, { requireLines = true } = {}) {
  if (!payload.recipientName) {
    throw new AppError('Vendor name is required', 400, 'VALIDATION_ERROR');
  }
  if (!payload.placeOfSupply) {
    throw new AppError('Vendor address is required', 400, 'VALIDATION_ERROR');
  }
  if (requireLines && (!payload.lineItems || !payload.lineItems.length)) {
    throw new AppError('At least one line item is required', 400, 'VALIDATION_ERROR');
  }
  if (requireLines && !(payload.grandTotal >= 0)) {
    throw new AppError('Grand total is invalid', 400, 'VALIDATION_ERROR');
  }
}

export function normalizeProformaPayload(body = {}, orgProfile = DEFAULT_ORG_PROFILE) {
  const documentDate = trimStr(body.documentDate) || todayIso();
  const period = documentNumberPeriod(documentDate);
  const recipientStateCode = trimStr(body.recipientStateCode);
  const taxMode = usesIgst(recipientStateCode, orgProfile.stateCode) ? 'igst' : 'cgst_sgst';
  const rawLines = Array.isArray(body.lineItems) ? body.lineItems : [];
  const lineItems = rawLines
    .filter((row) => trimStr(row.description) || trimStr(row.sectionTitle))
    .map((row, index) => normalizeLineItem(row, index, taxMode));

  const totals = computeDocumentTotals(lineItems, {
    cnAmount: body.cnAmount,
    dnAmount: body.dnAmount,
    advanceReceived: body.advanceReceived,
  });

  const paymentTermsDays =
    body.paymentTermsDays != null && body.paymentTermsDays !== ''
      ? Number(body.paymentTermsDays)
      : Number(orgProfile.defaultPaymentTermsDays) || 45;

  let dueDate = trimStr(body.dueDate);
  if (!dueDate && documentDate && paymentTermsDays) {
    const d = new Date(documentDate);
    d.setDate(d.getDate() + paymentTermsDays);
    dueDate = d.toISOString().slice(0, 10);
  }

  const terms = Array.isArray(body.terms)
    ? body.terms.map((t) => String(t).trim()).filter(Boolean)
    : trimStr(body.terms)
      ? String(body.terms)
          .split('\n')
          .map((t) => t.trim())
          .filter(Boolean)
      : [...(orgProfile.defaultTerms || [])];

  return {
    documentType: 'proforma',
    documentDate,
    dueDate,
    fiscalYear: fiscalYearLabel(documentDate),
    documentPeriod: period.periodKey,
    clientId: body.clientId || null,
    clientMasterId: body.clientMasterId || null,
    recipientName: trimStr(body.recipientName),
    projectName: trimStr(body.projectName),
    placeOfSupply: trimStr(body.placeOfSupply),
    deliveryAddress: trimStr(body.deliveryAddress),
    contactPerson: trimStr(body.contactPerson),
    contactEmail: trimStr(body.contactEmail),
    recipientGstin: trimStr(body.recipientGstin),
    recipientPan: trimStr(body.recipientPan),
    recipientStateCode,
    reference: trimStr(body.reference),
    cnReference: trimStr(body.cnReference),
    dnReference: trimStr(body.dnReference),
    receiptVoucher: trimStr(body.receiptVoucher),
    paymentTermsDays,
    reverseCharge: trimStr(body.reverseCharge) === 'Y' ? 'Y' : 'N',
    lineItems,
    terms,
    customNotes: trimStr(body.customNotes),
    taxMode,
    ...totals,
  };
}

export function validateProformaPayload(payload, { requireLines = true } = {}) {
  if (!payload.recipientName) {
    throw new AppError('Recipient name is required', 400, 'VALIDATION_ERROR');
  }
  if (requireLines && (!payload.lineItems || !payload.lineItems.length)) {
    throw new AppError('At least one line item is required', 400, 'VALIDATION_ERROR');
  }
  if (
    requireLines &&
    !payload.lineItems.some((line) => trimStr(line.description))
  ) {
    throw new AppError('At least one service line with a description is required', 400, 'VALIDATION_ERROR');
  }
  if (requireLines && !(payload.grandTotal > 0)) {
    throw new AppError('Grand total must be greater than zero', 400, 'VALIDATION_ERROR');
  }
}

export function assertEditableStatus(status) {
  if (!['Draft', 'Uploaded'].includes(status)) {
    throw new AppError('Only draft or uploaded documents can be edited', 400, 'VALIDATION_ERROR');
  }
}

export function assertIssuable(status) {
  if (!['Draft', 'Uploaded'].includes(status)) {
    throw new AppError('Document cannot be issued in its current status', 400, 'VALIDATION_ERROR');
  }
}

export function isValidCommercialStatus(status) {
  return COMMERCIAL_DOC_STATUSES.includes(status);
}
