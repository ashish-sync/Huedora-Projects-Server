import { AppError } from '../../utils/helpers.js';
import {
  COMMERCIAL_DOC_STATUSES,
  DEFAULT_ORG_PROFILE,
  DEFAULT_SAC_CODE,
} from './finance.constants.js';
import {
  documentNumberPeriod,
  fiscalYearLabel,
  nextCommercialDocumentNumber,
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

export { fiscalYearLabel };

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

export function resolveTaxMode(recipientStateCode, orgStateCode) {
  return usesIgst(recipientStateCode, orgStateCode) ? 'igst' : 'cgst_sgst';
}

/** Derive IGST or split CGST/SGST from whichever rate fields are populated. */
export function resolveLineGstRates(raw = {}, taxMode = 'igst') {
  const igstRaw = toAmount(raw.igstRate);
  const cgstRaw = toAmount(raw.cgstRate);
  const sgstRaw = toAmount(raw.sgstRate);
  const gstRaw = toAmount(raw.gstRate);
  const hasIgst = igstRaw > 0;
  const hasSplit = cgstRaw > 0 || sgstRaw > 0;
  const combined = hasIgst ? igstRaw : hasSplit ? cgstRaw + sgstRaw : gstRaw > 0 ? gstRaw : 0;

  if (taxMode === 'igst') {
    return { igstRate: combined, cgstRate: 0, sgstRate: 0 };
  }
  if (hasSplit) {
    return { igstRate: 0, cgstRate: cgstRaw, sgstRate: sgstRaw };
  }
  const half = Math.round((combined / 2) * 100) / 100;
  return { igstRate: 0, cgstRate: half, sgstRate: half };
}

export function normalizeLineItem(raw = {}, index = 0, taxMode = 'igst') {
  const qty = toAmount(raw.qty) || 0;
  const rate = toAmount(raw.rate) || 0;
  const discount = toAmount(raw.discount) || 0;
  let amount = raw.amount != null && raw.amount !== '' ? toAmount(raw.amount) : qty * rate - discount;
  if (amount < 0) amount = 0;
  const taxableAmount = toAmount(raw.taxableAmount) || amount;
  const { igstRate, cgstRate, sgstRate } = resolveLineGstRates(raw, taxMode);

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
    'udyam',
    'udyamLabel',
    'bankName',
    'accountHolder',
    'accountNumber',
    'ifscCode',
    'bankBranch',
    'upiId',
    'logoDataUrl',
    'paymentQrDataUrl',
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

export async function nextProformaNumber(documentDate) {
  return nextCommercialDocumentNumber('proforma', documentDate);
}

export async function nextPurchaseOrderNumber(documentDate) {
  return nextCommercialDocumentNumber('purchase_order', documentDate);
}

export async function nextClientInvoiceNumber(documentDate) {
  return nextCommercialDocumentNumber('client_invoice', documentDate);
}

export async function nextCreditNoteNumber(documentDate) {
  return nextCommercialDocumentNumber('credit_note', documentDate);
}

export async function nextDebitNoteNumber(documentDate) {
  return nextCommercialDocumentNumber('debit_note', documentDate);
}

export async function nextDeliveryChallanNumber(documentDate) {
  return nextCommercialDocumentNumber('delivery_challan', documentDate);
}

export async function nextBillOfSupplyNumber(documentDate) {
  return nextCommercialDocumentNumber('bill_of_supply', documentDate);
}

/** Assign official document number on approval (PREFIX/FY/MM/SEQ). */
export async function assignCommercialDocumentNumber(row, { force = false } = {}) {
  if (!force && trimStr(row.documentNumber)) return row.documentNumber;
  const number = await nextCommercialDocumentNumber(row.documentType, row.documentDate);
  row.documentNumber = number;
  const period = documentNumberPeriod(row.documentDate);
  row.documentPeriod = period.periodKey;
  row.fiscalYear = period.fy;
  return number;
}

export function normalizePoLineItem(raw = {}, index = 0, taxMode = 'igst') {
  const isFoc = Boolean(raw.isFoc);
  const qty = toAmount(raw.qty) || 0;
  const rate = isFoc ? 0 : toAmount(raw.rate) || 0;
  const discount = isFoc ? 0 : toAmount(raw.discount) || 0;
  let amount = raw.amount != null && raw.amount !== '' ? toAmount(raw.amount) : qty * rate - discount;
  if (amount < 0) amount = 0;
  const taxableAmount = toAmount(raw.taxableAmount) || amount;
  const { igstRate, cgstRate, sgstRate } = resolveLineGstRates(raw, taxMode);

  let igstAmount = 0;
  let cgstAmount = 0;
  let sgstAmount = 0;
  if (taxMode === 'igst') {
    igstAmount = Math.round(((taxableAmount * igstRate) / 100) * 100) / 100;
  } else {
    cgstAmount = Math.round(((taxableAmount * cgstRate) / 100) * 100) / 100;
    sgstAmount = Math.round(((taxableAmount * sgstRate) / 100) * 100) / 100;
  }

  const totalAmount =
    raw.totalAmount != null && raw.totalAmount !== ''
      ? toAmount(raw.totalAmount)
      : Math.round((taxableAmount + igstAmount + cgstAmount + sgstAmount) * 100) / 100;

  return {
    description: trimStr(raw.description),
    make: trimStr(raw.make),
    model: trimStr(raw.model),
    unit: trimStr(raw.unit || raw.uom) || 'Nos',
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
    isFoc,
    sortOrder: Number(raw.sortOrder) || index + 1,
  };
}

export function computePurchaseOrderTotals(lineItems = [], roundOff = 0) {
  const subtotal = lineItems.reduce((s, row) => s + (Number(row.taxableAmount ?? row.amount) || 0), 0);
  const taxAmount = lineItems.reduce(
    (s, row) => s + (Number(row.igstAmount) || 0) + (Number(row.cgstAmount) || 0) + (Number(row.sgstAmount) || 0),
    0
  );
  const rawTotal = subtotal + taxAmount + toAmount(roundOff);
  const grandTotal = Math.round(rawTotal * 100) / 100;
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    roundOff: toAmount(roundOff),
    grandTotal,
    amountInWords: amountInWordsIndian(grandTotal),
  };
}

export function normalizePurchaseOrderPayload(body = {}, orgProfile = DEFAULT_ORG_PROFILE) {
  const documentDate = trimStr(body.documentDate) || todayIso();
  const period = documentNumberPeriod(documentDate);
  const vendorStateCode = trimStr(body.vendorStateCode || body.recipientStateCode);
  const taxMode = resolveTaxMode(vendorStateCode, orgProfile.stateCode);
  const rawLines = Array.isArray(body.lineItems) ? body.lineItems : [];
  const lineItems = rawLines
    .filter((row) => trimStr(row.description) || Number(row.qty) || Number(row.rate))
    .map((row, index) => normalizePoLineItem(row, index, taxMode));

  const totals = computePurchaseOrderTotals(lineItems, body.roundOff);

  const terms = Array.isArray(body.terms)
    ? body.terms.map((t) => String(t).trim()).filter(Boolean)
    : trimStr(body.terms)
      ? String(body.terms)
          .split('\n')
          .map((t) => t.trim())
          .filter(Boolean)
      : [...(orgProfile.defaultPoTerms || DEFAULT_ORG_PROFILE.defaultPoTerms || [])];

  const legal = orgProfile.legalName || 'Tylo Care Private Limited';
  const office = orgProfile.registeredOffice || '';

  return {
    documentType: 'purchase_order',
    documentDate,
    dueDate: trimStr(body.expectedDeliveryDate || body.dueDate),
    fiscalYear: fiscalYearLabel(documentDate),
    documentPeriod: period.periodKey,
    contactId: body.contactId || null,
    recipientName: trimStr(body.vendorName || body.recipientName),
    placeOfSupply: trimStr(body.vendorAddress || body.placeOfSupply),
    deliveryAddress: trimStr(body.deliveryAddress),
    contactPerson: trimStr(body.contactPerson),
    contactEmail: trimStr(body.contactEmail),
    recipientGstin: trimStr(body.vendorGstin || body.recipientGstin),
    recipientStateCode: vendorStateCode,
    projectName: trimStr(body.projectCostCentre || body.projectName || body.reference),
    reference: trimStr(body.vendorQuoteRef || body.reference),
    referenceDate: trimStr(body.vendorQuoteDate || body.referenceDate),
    lineItems,
    terms,
    customNotes: trimStr(body.notes || body.customNotes),
    taxMode,
    // Snapshot logistics fields
    revisionNo: body.revisionNo != null && body.revisionNo !== '' ? Number(body.revisionNo) : 0,
    vendorQuoteRef: trimStr(body.vendorQuoteRef || body.reference),
    vendorQuoteDate: trimStr(body.vendorQuoteDate || body.referenceDate),
    projectCostCentre: trimStr(body.projectCostCentre || body.projectName),
    buyerCompanyName: trimStr(body.buyerCompanyName || legal),
    buyerAddress: trimStr(body.buyerAddress || office),
    buyerGstin: trimStr(body.buyerGstin || orgProfile.gstin),
    buyerContactPerson: trimStr(body.buyerContactPerson),
    buyerMobile: trimStr(body.buyerMobile || orgProfile.phone),
    buyerEmail: trimStr(body.buyerEmail || orgProfile.email),
    vendorCode: trimStr(body.vendorCode),
    vendorMobile: trimStr(body.vendorMobile),
    vendorAddress: trimStr(body.vendorAddress || body.placeOfSupply),
    vendorGstin: trimStr(body.vendorGstin || body.recipientGstin),
    deliveryContact: trimStr(body.deliveryContact),
    deliveryMobile: trimStr(body.deliveryMobile),
    expectedDeliveryDate: trimStr(body.expectedDeliveryDate || body.dueDate),
    deliveryInstructions: trimStr(body.deliveryInstructions || body.shippingInstructions),
    billingAddress: trimStr(body.billingAddress) || [legal, office].filter(Boolean).join(', '),
    billingGstin: trimStr(body.billingGstin || orgProfile.gstin),
    billingState: trimStr(body.billingState || orgProfile.state),
    billingStateCode: trimStr(body.billingStateCode || orgProfile.stateCode),
    billingPlaceOfSupply: trimStr(body.billingPlaceOfSupply),
    paymentTerms: trimStr(body.paymentTerms),
    freight: trimStr(body.freight),
    insurance: trimStr(body.insurance),
    deliveryTerms: trimStr(body.deliveryTerms),
    warranty: trimStr(body.warranty),
    validity: trimStr(body.validity),
    ...totals,
  };
}

export function validatePurchaseOrderPayload(payload, { requireLines = true } = {}) {
  if (requireLines && !payload.recipientName) {
    throw new AppError('Vendor name is required', 400, 'VALIDATION_ERROR');
  }
  if (requireLines && !payload.placeOfSupply) {
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
  const taxMode = resolveTaxMode(recipientStateCode, orgProfile.stateCode);
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
    projectName: trimStr(body.servicePeriod || body.projectName),
    placeOfSupply: trimStr(body.placeOfSupply),
    deliveryAddress: trimStr(body.deliveryAddress || body.shipToAddress),
    contactPerson: trimStr(body.contactPerson),
    contactEmail: trimStr(body.contactEmail),
    recipientGstin: trimStr(body.recipientGstin),
    recipientPan: trimStr(body.recipientPan),
    recipientStateCode,
    recipientStateName: trimStr(body.recipientStateName),
    reference: trimStr(body.reference),
    referenceDate: trimStr(body.referenceDate),
    servicePeriod: trimStr(body.servicePeriod || body.projectName),
    cnReference: trimStr(body.cnReference),
    dnReference: trimStr(body.dnReference),
    receiptVoucher: trimStr(body.receiptVoucher),
    paymentTermsDays,
    reverseCharge: trimStr(body.reverseCharge) === 'Y' ? 'Y' : 'N',
    lineItems,
    terms,
    customNotes: trimStr(body.customNotes),
    declaration: trimStr(body.declaration),
    shipToName: trimStr(body.shipToName),
    shipToContactPerson: trimStr(body.shipToContactPerson),
    shipToAddress: trimStr(body.shipToAddress || body.deliveryAddress),
    shipToGstin: trimStr(body.shipToGstin),
    shipToStateCode: trimStr(body.shipToStateCode),
    shipToStateName: trimStr(body.shipToStateName),
    taxMode,
    ...totals,
  };
}

export function normalizeClientInvoicePayload(body = {}, orgProfile = DEFAULT_ORG_PROFILE) {
  const payload = normalizeProformaPayload(body, orgProfile);
  return { ...payload, documentType: 'client_invoice' };
}

export function normalizeCreditNotePayload(body = {}, orgProfile = DEFAULT_ORG_PROFILE) {
  const base = normalizeProformaPayload(
    {
      ...body,
      paymentTermsDays:
        body.paymentTermsDays != null && body.paymentTermsDays !== ''
          ? body.paymentTermsDays
          : 30,
    },
    orgProfile
  );
  return {
    ...base,
    documentType: 'credit_note',
    referenceDate: trimStr(body.referenceDate),
    servicePeriod: trimStr(body.servicePeriod || body.projectName),
    projectName: trimStr(body.servicePeriod || body.projectName),
    cnReference: trimStr(body.cnReference),
    originalInvoiceDate: trimStr(body.originalInvoiceDate),
    creditReason:
      trimStr(body.creditReason) || 'Rate Revision / Cancellation / Service Adjustment',
    shipToName: trimStr(body.shipToName),
    shipToContactPerson: trimStr(body.shipToContactPerson),
    shipToAddress: trimStr(body.shipToAddress),
    shipToGstin: trimStr(body.shipToGstin),
    shipToStateCode: trimStr(body.shipToStateCode),
    shipToStateName: trimStr(body.shipToStateName),
    recipientStateName: trimStr(body.recipientStateName),
    terms: Array.isArray(body.terms) && body.terms.length
      ? body.terms.map((t) => String(t).trim()).filter(Boolean)
      : ['Payment is due within 30 days from the date of invoice.'],
  };
}

export function normalizeDebitNotePayload(body = {}, orgProfile = DEFAULT_ORG_PROFILE) {
  const base = normalizeProformaPayload(
    {
      ...body,
      paymentTermsDays:
        body.paymentTermsDays != null && body.paymentTermsDays !== ''
          ? body.paymentTermsDays
          : 30,
    },
    orgProfile
  );
  return {
    ...base,
    documentType: 'debit_note',
    referenceDate: trimStr(body.referenceDate),
    servicePeriod: trimStr(body.servicePeriod || body.projectName),
    projectName: trimStr(body.servicePeriod || body.projectName),
    dnReference: trimStr(body.dnReference),
    originalInvoiceDate: trimStr(body.originalInvoiceDate),
    debitReason:
      trimStr(body.debitReason) || 'Additional Service / Underbilling / Rate Revision / Tax Adjustment',
    shipToName: trimStr(body.shipToName),
    shipToContactPerson: trimStr(body.shipToContactPerson),
    shipToAddress: trimStr(body.shipToAddress),
    shipToGstin: trimStr(body.shipToGstin),
    shipToStateCode: trimStr(body.shipToStateCode),
    shipToStateName: trimStr(body.shipToStateName),
    recipientStateName: trimStr(body.recipientStateName),
    terms: Array.isArray(body.terms) && body.terms.length
      ? body.terms.map((t) => String(t).trim()).filter(Boolean)
      : ['Payment is due within 30 days from the date of invoice.'],
  };
}

export function normalizeDeliveryChallanPayload(body = {}, orgProfile = DEFAULT_ORG_PROFILE) {
  const documentDate = trimStr(body.documentDate) || todayIso();
  const period = documentNumberPeriod(documentDate);
  const rawLines = Array.isArray(body.lineItems) ? body.lineItems : [];
  const lineItems = rawLines
    .filter(
      (row) =>
        trimStr(row.description) ||
        trimStr(row.assetId) ||
        trimStr(row.manufacturerSerialNo) ||
        trimStr(row.serialNo) ||
        Number(row.qty)
    )
    .map((row, index) => ({
      assetId: trimStr(row.assetId),
      description: trimStr(row.description),
      make: trimStr(row.make),
      model: trimStr(row.model),
      manufacturerSerialNo: trimStr(row.manufacturerSerialNo || row.serialNo),
      qty: row.qty != null && row.qty !== '' ? Number(row.qty) : '',
      accessories: trimStr(row.accessories),
      condition: trimStr(row.condition),
      remarks: trimStr(row.remarks),
      sacCode: '',
      rate: 0,
      amount: 0,
      discount: 0,
      taxableAmount: 0,
      igstRate: 0,
      cgstRate: 0,
      sgstRate: 0,
      igstAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      totalAmount: 0,
      sortOrder: Number(row.sortOrder) || index + 1,
    }));

  return {
    documentType: 'delivery_challan',
    documentDate,
    dueDate: trimStr(body.expectedDeliveryDate || body.dueDate),
    fiscalYear: fiscalYearLabel(documentDate),
    documentPeriod: period.periodKey,
    clientId: body.clientId || null,
    clientMasterId: body.clientMasterId || null,
    recipientName: trimStr(body.recipientName),
    projectName: trimStr(body.purposeOfMovement || body.projectName),
    placeOfSupply: trimStr(body.fromAddress || body.placeOfSupply || orgProfile.registeredOffice),
    deliveryAddress: trimStr(body.deliveryAddress || body.shipToAddress),
    contactPerson: trimStr(body.contactPerson),
    contactEmail: trimStr(body.contactEmail || body.deliverToEmail),
    recipientGstin: trimStr(body.recipientGstin),
    recipientPan: '',
    recipientStateCode: trimStr(body.recipientStateCode),
    reference: trimStr(body.awbNo || body.reference),
    referenceDate: '',
    servicePeriod: '',
    cnReference: '',
    dnReference: '',
    receiptVoucher: '',
    paymentTermsDays: 0,
    reverseCharge: 'N',
    lineItems,
    terms: [],
    customNotes: trimStr(body.customNotes || body.declaration),
    taxMode: 'igst',
    subtotal: 0,
    taxAmount: 0,
    cnAmount: 0,
    dnAmount: 0,
    advanceReceived: 0,
    roundOff: 0,
    grandTotal: 0,
    amountInWords: '',
    shipToName: trimStr(body.shipToName || body.recipientName),
    shipToContactPerson: trimStr(body.shipToContactPerson || body.contactPerson),
    shipToAddress: trimStr(body.shipToAddress || body.deliveryAddress),
    transporterName: trimStr(body.courierName || body.transporterName),
    vehicleNo: trimStr(body.vehicleNo),
    // DC-specific fields persisted on the row
    dispatchDate: trimStr(body.dispatchDate),
    expectedDeliveryDate: trimStr(body.expectedDeliveryDate || body.dueDate),
    fromCompanyName: trimStr(body.fromCompanyName || orgProfile.legalName),
    fromAddress: trimStr(body.fromAddress || orgProfile.registeredOffice),
    fromGstin: trimStr(body.fromGstin || orgProfile.gstin),
    fromContactPerson: trimStr(body.fromContactPerson),
    fromMobile: trimStr(body.fromMobile || orgProfile.phone),
    fromEmail: trimStr(body.fromEmail || orgProfile.email),
    recipientType: trimStr(body.recipientType),
    deliverToCompany: trimStr(body.deliverToCompany),
    deliverToMobile: trimStr(body.deliverToMobile),
    courierName: trimStr(body.courierName || body.transporterName),
    awbNo: trimStr(body.awbNo),
    courierMode: trimStr(body.courierMode),
    packageCount: body.packageCount != null && body.packageCount !== '' ? Number(body.packageCount) : '',
    originCity: trimStr(body.originCity),
    destinationCity: trimStr(body.destinationCity),
    purposeOfMovement: trimStr(body.purposeOfMovement || body.projectName),
    packedBy: trimStr(body.packedBy),
    checkedBy: trimStr(body.checkedBy),
    dispatchedBy: trimStr(body.dispatchedBy),
    receivedBy: trimStr(body.receivedBy),
    receivedMobile: trimStr(body.receivedMobile),
    conditionOnReceipt: trimStr(body.conditionOnReceipt),
    receivedDate: trimStr(body.receivedDate),
    declaration:
      trimStr(body.declaration) ||
      'The goods covered under this Delivery Challan are being transported for reasons other than sale and do not constitute a taxable supply under the applicable provisions of the CGST Act, 2017. This Delivery Challan is issued solely for the movement, tracking and acknowledgement of goods.',
  };
}

export function validateDeliveryChallanPayload(payload, { requireLines = true } = {}) {
  if (requireLines && !payload.recipientName) {
    throw new AppError('Deliver-to name is required', 400, 'VALIDATION_ERROR');
  }
  if (requireLines && (!payload.lineItems || !payload.lineItems.length)) {
    throw new AppError('At least one item line is required', 400, 'VALIDATION_ERROR');
  }
  if (
    requireLines &&
    !payload.lineItems.some(
      (line) => trimStr(line.description) || trimStr(line.assetId) || trimStr(line.manufacturerSerialNo)
    )
  ) {
    throw new AppError('At least one item with Asset ID, description, or serial number is required', 400, 'VALIDATION_ERROR');
  }
}

export function normalizeBillOfSupplyPayload(body = {}, orgProfile = DEFAULT_ORG_PROFILE) {
  const base = normalizeProformaPayload(
    {
      ...body,
      paymentTermsDays:
        body.paymentTermsDays != null && body.paymentTermsDays !== ''
          ? body.paymentTermsDays
          : 30,
    },
    orgProfile
  );

  // Bill of Supply: GST NIL / EXEMPT — charge no tax even if rates appear on the form.
  const lineItems = (base.lineItems || []).map((line) => {
    const taxableAmount = toAmount(line.taxableAmount);
    return {
      ...line,
      igstRate: 0,
      cgstRate: 0,
      sgstRate: 0,
      igstAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      totalAmount: taxableAmount,
    };
  });
  const totals = computeDocumentTotals(lineItems, {
    cnAmount: 0,
    dnAmount: 0,
    advanceReceived: toAmount(body.advanceReceived),
  });

  return {
    ...base,
    ...totals,
    documentType: 'bill_of_supply',
    lineItems,
    taxAmount: 0,
    referenceDate: trimStr(body.referenceDate),
    servicePeriod: trimStr(body.servicePeriod || body.projectName),
    projectName: trimStr(body.servicePeriod || body.projectName),
    shipToName: trimStr(body.shipToName),
    shipToContactPerson: trimStr(body.shipToContactPerson),
    shipToAddress: trimStr(body.shipToAddress),
    shipToGstin: trimStr(body.shipToGstin),
    shipToStateCode: trimStr(body.shipToStateCode),
    shipToStateName: trimStr(body.shipToStateName),
    recipientStateName: trimStr(body.recipientStateName),
    terms: Array.isArray(body.terms) && body.terms.length
      ? body.terms.map((t) => String(t).trim()).filter(Boolean)
      : [
          'Payment is due within 30 days from the date of the Bill of Supply unless otherwise agreed.',
        ],
  };
}

export function normalizeQuotationPayload(body = {}, orgProfile = DEFAULT_ORG_PROFILE) {
  const base = normalizeProformaPayload(
    {
      ...body,
      paymentTermsDays:
        body.paymentTermsDays != null && body.paymentTermsDays !== ''
          ? body.paymentTermsDays
          : 30,
    },
    orgProfile
  );
  return {
    ...base,
    documentType: 'quotation',
    referenceDate: trimStr(body.referenceDate),
    servicePeriod: trimStr(body.servicePeriod || body.projectName),
    projectName: trimStr(body.servicePeriod || body.projectName),
    shipToName: trimStr(body.shipToName),
    shipToContactPerson: trimStr(body.shipToContactPerson),
    shipToAddress: trimStr(body.shipToAddress),
    shipToGstin: trimStr(body.shipToGstin),
    shipToStateCode: trimStr(body.shipToStateCode),
    shipToStateName: trimStr(body.shipToStateName),
    recipientStateName: trimStr(body.recipientStateName),
    declaration:
      trimStr(body.declaration) ||
      'This quotation is issued for budgetary/commercial evaluation only. It is neither a Proforma Invoice nor a Tax Invoice. Prices are based on the proposed scope, subject to applicable GST, commercial discussions and issuance of a Purchase Order/Work Order. A Proforma Invoice or Tax Invoice will be issued, as applicable.',
    terms: Array.isArray(body.terms) && body.terms.length
      ? body.terms.map((t) => String(t).trim()).filter(Boolean)
      : [
          'Payment terms: 30 days from the date of the Tax Invoice unless otherwise agreed in writing.',
        ],
  };
}

export async function nextQuotationNumber(documentDate) {
  return nextCommercialDocumentNumber('quotation', documentDate);
}

export const validateClientInvoicePayload = validateProformaPayload;
export const validateCreditNotePayload = validateProformaPayload;
export const validateDebitNotePayload = validateProformaPayload;
export const validateBillOfSupplyPayload = validateProformaPayload;
export const validateQuotationPayload = validateProformaPayload;

export function validateProformaPayload(payload, { requireLines = true } = {}) {
  if (requireLines && !payload.recipientName) {
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
  if (!['Draft', 'Uploaded', 'Submitted', 'Approved'].includes(status)) {
    throw new AppError('Document cannot be issued in its current status', 400, 'VALIDATION_ERROR');
  }
}

export function assertSubmittable(status) {
  if (!['Draft', 'Uploaded'].includes(status)) {
    throw new AppError('Only draft documents can be submitted for approval', 400, 'VALIDATION_ERROR');
  }
}

export function assertApprovable(status) {
  if (status !== 'Submitted') {
    throw new AppError('Only submitted documents can be approved', 400, 'VALIDATION_ERROR');
  }
}

/** Designations allowed to approve/reject commercial documents (either one). */
export const COMMERCIAL_APPROVER_DESIGNATIONS = ['operations head', 'senior manager'];

/** Who may edit Organisation master (Admin via *). */
export const ORG_MASTER_EDITOR_DESIGNATIONS = [
  'operations head',
  'senior manager',
  'manager',
];

export function normalizeDesignationKey(designation) {
  return String(designation || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isCommercialApproverDesignation(designation) {
  return COMMERCIAL_APPROVER_DESIGNATIONS.includes(normalizeDesignationKey(designation));
}

export function isOrgMasterEditorDesignation(designation) {
  return ORG_MASTER_EDITOR_DESIGNATIONS.includes(normalizeDesignationKey(designation));
}

/**
 * Operations Head or Senior Manager may approve/reject; Admin (*) always can.
 */
export function assertCommercialApprover(user, permissions) {
  const perms = permissions instanceof Set ? permissions : new Set(permissions || []);
  if (perms.has('*')) return;
  if (isCommercialApproverDesignation(user?.designation)) return;
  throw new AppError(
    'Only Operations Head or Senior Manager can approve commercial documents',
    403,
    'FORBIDDEN',
  );
}

/**
 * Admin, Operations Head, Senior Manager, or Manager may edit Organisation master.
 */
export function assertOrgMasterEditor(user, permissions) {
  const perms = permissions instanceof Set ? permissions : new Set(permissions || []);
  if (perms.has('*')) return;
  if (isOrgMasterEditorDesignation(user?.designation)) return;
  throw new AppError(
    'Only Admin, Operations Head, Senior Manager, or Manager can edit Organisation master',
    403,
    'FORBIDDEN',
  );
}

/**
 * Record a payment against an issued commercial document.
 * Same amount as grand total → Fully paid; otherwise Partially paid.
 */
export function applyCommercialPayment(row, amountInput) {
  if (!['Issued', 'Approved'].includes(row.status)) {
    throw new AppError('Only issued or approved documents can record payment', 400, 'VALIDATION_ERROR');
  }
  const amount = toAmount(amountInput);
  if (!(amount > 0)) {
    throw new AppError('Enter a payment amount greater than zero', 400, 'VALIDATION_ERROR');
  }
  const invoiceAmount = toAmount(row.grandTotal);
  if (!(invoiceAmount > 0)) {
    throw new AppError('Document has no invoice amount to pay against', 400, 'VALIDATION_ERROR');
  }
  if (amount > invoiceAmount + 0.009) {
    throw new AppError('Payment cannot exceed the invoice amount', 400, 'VALIDATION_ERROR');
  }
  const fullyPaid = Math.abs(amount - invoiceAmount) < 0.01;
  row.paidAmount = amount;
  row.paymentStatus = fullyPaid ? 'Fully paid' : 'Partially paid';
  row.paidAt = new Date().toISOString();
  return row;
}

export function assertRejectable(status) {
  if (status !== 'Submitted') {
    throw new AppError('Only submitted documents can be rejected', 400, 'VALIDATION_ERROR');
  }
}

export function assertCancellable(status) {
  if (['Issued', 'Cancelled', 'Converted'].includes(status)) {
    throw new AppError('Document cannot be cancelled in its current status', 400, 'VALIDATION_ERROR');
  }
}

/** Extra UI fields stored alongside normalized commercial payload */
export function extractBuilderExtras(body = {}) {
  const out = {};
  if (body.builderForm !== undefined) {
    out.builderForm = body.builderForm && typeof body.builderForm === 'object' ? body.builderForm : null;
  }
  if (body.declaration !== undefined) out.declaration = trimStr(body.declaration);
  if (body.shipToName !== undefined) out.shipToName = trimStr(body.shipToName);
  if (body.shipToContactPerson !== undefined) {
    out.shipToContactPerson = trimStr(body.shipToContactPerson);
  }
  if (body.shipToAddress !== undefined) out.shipToAddress = trimStr(body.shipToAddress);
  if (body.shipToGstin !== undefined) out.shipToGstin = trimStr(body.shipToGstin);
  if (body.shipToStateCode !== undefined) out.shipToStateCode = trimStr(body.shipToStateCode);
  if (body.shipToStateName !== undefined) out.shipToStateName = trimStr(body.shipToStateName);
  if (body.recipientStateName !== undefined) out.recipientStateName = trimStr(body.recipientStateName);
  if (body.referenceDate !== undefined) out.referenceDate = trimStr(body.referenceDate);
  if (body.servicePeriod !== undefined) out.servicePeriod = trimStr(body.servicePeriod);
  if (body.originalInvoiceDate !== undefined) out.originalInvoiceDate = trimStr(body.originalInvoiceDate);
  if (body.creditReason !== undefined) out.creditReason = trimStr(body.creditReason);
  if (body.debitReason !== undefined) out.debitReason = trimStr(body.debitReason);
  if (body.vehicleNo !== undefined) out.vehicleNo = trimStr(body.vehicleNo);
  if (body.transporterName !== undefined) out.transporterName = trimStr(body.transporterName);
  // Delivery challan + purchase order logistics fields
  const extraKeys = [
    'dispatchDate',
    'expectedDeliveryDate',
    'fromCompanyName',
    'fromAddress',
    'fromGstin',
    'fromContactPerson',
    'fromMobile',
    'fromEmail',
    'recipientType',
    'deliverToCompany',
    'deliverToMobile',
    'courierName',
    'awbNo',
    'courierMode',
    'packageCount',
    'originCity',
    'destinationCity',
    'purposeOfMovement',
    'packedBy',
    'checkedBy',
    'dispatchedBy',
    'receivedBy',
    'receivedMobile',
    'conditionOnReceipt',
    'receivedDate',
    'revisionNo',
    'vendorQuoteRef',
    'vendorQuoteDate',
    'projectCostCentre',
    'buyerCompanyName',
    'buyerAddress',
    'buyerGstin',
    'buyerContactPerson',
    'buyerMobile',
    'buyerEmail',
    'vendorCode',
    'vendorMobile',
    'vendorAddress',
    'vendorGstin',
    'deliveryContact',
    'deliveryMobile',
    'deliveryInstructions',
    'billingAddress',
    'billingGstin',
    'billingState',
    'billingStateCode',
    'billingPlaceOfSupply',
    'paymentTerms',
    'freight',
    'insurance',
    'deliveryTerms',
    'warranty',
    'validity',
  ];
  for (const key of extraKeys) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

export function isValidCommercialStatus(status) {
  return COMMERCIAL_DOC_STATUSES.includes(status);
}
