import { AppError } from '../../utils/helpers.js';
import { stripBuilderFormMedia } from '../../utils/stripEmbeddedMedia.js';
import { PERMISSIONS } from '../../config/constants.js';
import {
  COMMERCIAL_DOC_STATUSES,
  DEFAULT_ORG_PROFILE,
  DEFAULT_SAC_CODE,
} from './finance.constants.js';
import {
  DEFAULT_DOCUMENT_CODE,
  documentNumberPeriod,
  fiscalYearLabel,
  nextCommercialDocumentNumber,
  normalizeDocumentCode,
  normalizeDocumentNumberKey,
  historyHoldsDocumentNumber,
  parseDocumentNumber,
  validateManualDocumentNumber,
} from './documentNumbering.js';
import { FinanceCommercialDocument, FinanceOrgProfile } from './finance.model.js';

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

/** Add calendar days to a YYYY-MM-DD date (local). */
export function addDaysIso(dateText, days = 30) {
  const text = String(dateText || '').trim();
  const base =
    text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return '';
  base.setDate(base.getDate() + (Number(days) || 0));
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, '0');
  const dd = String(base.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export { fiscalYearLabel };

/** Display dates as DD-MM-YYYY across Finance One. */
export function formatDisplayDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).slice(0, 10));
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return String(iso);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ERP document headers — same DD-MM-YYYY standard. */
export function formatDisplayDateErp(iso) {
  if (!iso) return '—';
  const formatted = formatDisplayDate(iso);
  return formatted || '—';
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
  const autoRoundOff = Math.round((Math.round(rawTotal) - rawTotal) * 100) / 100;
  const hasManualRoundOff =
    adjustments.roundOff !== undefined &&
    adjustments.roundOff !== null &&
    String(adjustments.roundOff).trim() !== '';
  const roundOff = hasManualRoundOff
    ? Math.round((Number(adjustments.roundOff) || 0) * 100) / 100
    : autoRoundOff;
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

const ORG_SNAPSHOT_KEYS = [
  'name',
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
  'signatureDataUrl',
  'signatoryName',
  'defaultPaymentTermsDays',
  'defaultTerms',
  'proformaNotes',
  'defaultPoTerms',
  'defaultPurchaseTaxRate',
  'documentCode',
];

function orgPlain(row) {
  if (!row) return null;
  return row.toObject ? row.toObject() : { ...row };
}

export function inferDocumentCode(org = {}) {
  const existing = normalizeDocumentCode(org.documentCode);
  if (existing) return existing;
  const name = `${org.name || ''} ${org.legalName || ''}`.toLowerCase();
  if (/\bmedrento\b/.test(name)) return 'MD';
  if (/\brapid\b/.test(name)) return 'RD';
  if (/\btylo\b/.test(name)) return DEFAULT_DOCUMENT_CODE;
  if (org.isDefault || org._id === 'default') return DEFAULT_DOCUMENT_CODE;
  const letters = String(org.legalName || org.name || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (letters.length >= 2) return letters.slice(0, 2);
  return DEFAULT_DOCUMENT_CODE;
}

export function resolveOrgDocumentCode(org = {}) {
  return inferDocumentCode(org);
}

export async function assertUniqueDocumentCode(documentCode, excludeId = null) {
  const code = normalizeDocumentCode(documentCode);
  if (!code) {
    throw new AppError(
      'Document code must be 2–5 letters (e.g. TC, MD, RD, TYLO)',
      400,
      'VALIDATION_ERROR',
    );
  }
  const rows = await FinanceOrgProfile.find({});
  const clash = rows.find((row) => {
    if (row.isDeleted) return false;
    if (excludeId && String(row._id) === String(excludeId)) return false;
    return normalizeDocumentCode(row.documentCode) === code;
  });
  if (clash) {
    throw new AppError(
      `Document code ${code} is already used by ${clash.name || clash.legalName || 'another organisation'}`,
      409,
      'CONFLICT',
    );
  }
  return code;
}

async function uniquifyDocumentCode(preferred, excludeId = null) {
  const base = normalizeDocumentCode(preferred) || DEFAULT_DOCUMENT_CODE;
  const rows = await FinanceOrgProfile.find({});
  const used = new Set(
    rows
      .filter((row) => !row.isDeleted && !(excludeId && String(row._id) === String(excludeId)))
      .map((row) => normalizeDocumentCode(row.documentCode))
      .filter(Boolean),
  );
  if (!used.has(base)) return base;
  for (let n = 2; n < 50; n++) {
    const candidate = `${base.slice(0, 4)}${n}`.slice(0, 5);
    if (!used.has(candidate) && normalizeDocumentCode(candidate) === candidate) return candidate;
  }
  throw new AppError('Could not allocate a unique document code', 409, 'CONFLICT');
}

export async function ensureOrgDocumentCode(row) {
  if (!row) return row;
  const current = normalizeDocumentCode(row.documentCode);
  if (current) return current;
  const inferred = await uniquifyDocumentCode(inferDocumentCode(row), row._id);
  row.documentCode = inferred;
  await row.save();
  return inferred;
}

export function numbersMatch(a, b) {
  const left = normalizeDocumentNumberKey(a);
  const right = normalizeDocumentNumberKey(b);
  return Boolean(left) && left === right;
}

export async function assertDocumentNumberAvailable(documentNumber, { excludeId = null } = {}) {
  const key = normalizeDocumentNumberKey(documentNumber);
  if (!key) {
    throw new AppError('Document number is required', 400, 'VALIDATION_ERROR');
  }
  const rows = await FinanceCommercialDocument.find({ isDeleted: false });
  const clash = rows.find((row) => {
    const sameRow = excludeId && String(row._id) === String(excludeId);
    if (!sameRow && numbersMatch(row.documentNumber, key)) return true;
    const stage = String(row.status || '');
    if (
      !sameRow
      && ['Draft', 'Submitted', 'Uploaded'].includes(stage)
      && numbersMatch(row.requestedDocumentNumber, key)
    ) {
      return true;
    }
    if (historyHoldsDocumentNumber(row.documentNumberHistory, key)) return true;
    return false;
  });
    if (clash) {
    throw new AppError(
      `Document number ${key} is already used`,
      409,
      'CONFLICT',
    );
  }
  return key;
}

export async function persistRequestedDocumentNumber(row, body = {}, permissions = null) {
  if (!row || body.requestedDocumentNumber === undefined) return row;
  const stage = String(row.status || '');
  if (stage === 'Issued' || stage === 'Cancelled') return row;
  const raw = trimStr(body.requestedDocumentNumber);
  const isAdmin = Boolean(permissions?.has?.(PERMISSIONS.ALL) || permissions?.has?.('*'));
  if (!raw) {
    if (isAdmin) row.requestedDocumentNumber = '';
    return row;
  }
  if (!isAdmin && trimStr(row.requestedDocumentNumber) && numbersMatch(row.requestedDocumentNumber, raw)) {
    return row;
  }
  if (!isAdmin) return row;
  const org = await resolveOrgProfileId(row.orgProfileId || 'default');
  const code = resolveOrgDocumentCode(org);
  const canonical = validateManualDocumentNumber(raw, row.documentType, { documentCode: code });
  await assertDocumentNumberAvailable(canonical, { excludeId: row._id });
  row.requestedDocumentNumber = canonical;
  return row;
}

/** Ensure the legacy default organisation exists (id = default). */
export async function getOrCreateOrgProfile() {
  let row = await FinanceOrgProfile.findOne({ _id: 'default' });
  if (!row) {
    row = await FinanceOrgProfile.create({
      _id: 'default',
      name: DEFAULT_ORG_PROFILE.legalName || 'Default organisation',
      slug: 'default',
      isDefault: true,
      isDeleted: false,
      documentCode: DEFAULT_DOCUMENT_CODE,
      ...DEFAULT_ORG_PROFILE,
    });
  } else {
    let dirty = false;
    if (!row.name) {
      row.name = row.legalName || DEFAULT_ORG_PROFILE.legalName || 'Default organisation';
      dirty = true;
    }
    if (!normalizeDocumentCode(row.documentCode)) {
      row.documentCode = DEFAULT_DOCUMENT_CODE;
      dirty = true;
    }
    if (row.isDefault !== true) {
      row.isDefault = true;
      dirty = true;
    }
    if (row.isDeleted) {
      row.isDeleted = false;
      dirty = true;
    }
    if (dirty) await row.save();
  }
  return row;
}

export async function listOrgProfiles() {
  await getOrCreateOrgProfile();
  const rows = await FinanceOrgProfile.find({});
  for (const row of rows) {
    if (!row.isDeleted) await ensureOrgDocumentCode(row);
  }
  return rows
    .filter((r) => !r.isDeleted)
    .sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return String(a.name || a.legalName || '').localeCompare(String(b.name || b.legalName || ''));
    });
}

/** Backfill orgProfileId on legacy commercial docs; snapshot Issued/Cancelled that lack one. */
export async function migrateCommercialDocumentsOrgBinding() {
  await getOrCreateOrgProfile();
  const rows = await FinanceCommercialDocument.find({ isDeleted: false });
  let updated = 0;
  for (const row of rows) {
    let dirty = false;
    if (!row.orgProfileId) {
      row.orgProfileId = 'default';
      dirty = true;
    }
    const stage = normalizeCommercialStage(row.status);
    if ((stage === 'Issued' || stage === 'Cancelled') && !row.orgSnapshot) {
      const live = await resolveOrgProfileId(row.orgProfileId);
      row.orgSnapshot = buildOrgSnapshot(live);
      dirty = true;
    }
    if (dirty) {
      await row.save();
      updated += 1;
    }
  }
  if (updated) {
    console.log(`[finance] Migrated org binding on ${updated} commercial document(s)`);
  }
  return updated;
}

export async function resolveOrgProfileId(orgProfileId) {
  const id = String(orgProfileId || '').trim() || 'default';
  let row = await FinanceOrgProfile.findOne({ _id: id });
  if (row && !row.isDeleted) return row;
  if (id !== 'default') {
    const fallback = await getOrCreateOrgProfile();
    return fallback;
  }
  return getOrCreateOrgProfile();
}

export function buildOrgSnapshot(orgProfile) {
  const src = orgPlain(orgProfile) || {};
  const snap = { orgProfileId: String(src._id || 'default'), frozenAt: new Date().toISOString() };
  for (const key of ORG_SNAPSHOT_KEYS) {
    if (src[key] !== undefined) snap[key] = src[key];
  }
  if (!snap.name) snap.name = snap.legalName || 'Organisation';
  return snap;
}

/**
 * Live master for drafting/normalize; frozen snapshot for Issued/Cancelled PDFs.
 */
export function orgSourceForDocument(row, liveOrg) {
  const stage = normalizeCommercialStage(row?.status);
  if ((stage === 'Issued' || stage === 'Cancelled') && row?.orgSnapshot && typeof row.orgSnapshot === 'object') {
    return { ...row.orgSnapshot };
  }
  return orgPlain(liveOrg) || {};
}

/** Freeze issuing organisation onto the document at approve/issue. */
export async function freezeOrgSnapshotOnIssue(row) {
  const live = await resolveOrgProfileId(row.orgProfileId || 'default');
  row.orgProfileId = String(live._id);
  row.orgSnapshot = buildOrgSnapshot(live);
  return live;
}

export async function createOrgProfile(body = {}, actor = {}) {
  await getOrCreateOrgProfile();
  const patch = await mergeOrgProfile(body);
  const name =
    trimStr(body.name) || trimStr(patch.legalName) || trimStr(body.legalName) || 'Organisation';
  const slugBase = trimStr(body.slug)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    || 'organisation';
  let slug = slugBase;
  let n = 1;
  while (await FinanceOrgProfile.findOne({ slug })) {
    slug = `${slugBase}-${++n}`;
  }
  const documentCode = await uniquifyDocumentCode(
    patch.documentCode || body.documentCode || inferDocumentCode({ name, legalName: patch.legalName || name }),
  );
  const id = `org_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const row = await FinanceOrgProfile.create({
    _id: id,
    name,
    slug,
    isDefault: false,
    isDeleted: false,
    ...DEFAULT_ORG_PROFILE,
    ...patch,
    documentCode,
    legalName: patch.legalName || name,
    createdAt: new Date().toISOString(),
    updatedById: actor._id || null,
    updatedByEmail: actor.email || '',
  });
  return row;
}

export async function mergeOrgProfile(body = {}) {
  const fields = [
    'name',
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
    'signatureDataUrl',
    'signatoryName',
    'defaultPaymentTermsDays',
    'defaultTerms',
    'proformaNotes',
    'defaultPoTerms',
    'defaultPurchaseTaxRate',
    'documentCode',
  ];
  const out = {};
  for (const key of fields) {
    if (body[key] === undefined) continue;
    let value;
    if (key === 'defaultTerms' || key === 'proformaNotes' || key === 'defaultPoTerms') {
      value = Array.isArray(body[key])
            ? body[key].map((t) => String(t).trim()).filter(Boolean)
            : String(body[key] || '')
                .split('\n')
                .map((t) => t.trim())
            .filter(Boolean);
    } else if (key === 'defaultPaymentTermsDays' || key === 'defaultPurchaseTaxRate') {
      value = Number(body[key]) || 0;
    } else if (key === 'documentCode') {
      value = normalizeDocumentCode(body[key]);
      if (!value) continue;
    } else {
      value = trimStr(body[key]);
      // Blank org master fields must not wipe GSTIN/PAN/bank on save.
      if (!value) continue;
    }
    out[key] = value;
  }

  const { optimizeImageDataUrl } = await import('../../storage/media/optimizeImage.js');
  for (const key of ['logoDataUrl', 'signatureDataUrl', 'paymentQrDataUrl']) {
    if (typeof out[key] === 'string' && out[key].startsWith('data:image')) {
      out[key] = await optimizeImageDataUrl(out[key]);
    }
  }
  return out;
}

export async function nextProformaNumber(documentDate, documentCode) {
  return nextCommercialDocumentNumber('proforma', documentDate, { documentCode });
}

export async function nextPurchaseOrderNumber(documentDate, documentCode) {
  return nextCommercialDocumentNumber('purchase_order', documentDate, { documentCode });
}

export async function nextClientInvoiceNumber(documentDate, documentCode) {
  return nextCommercialDocumentNumber('client_invoice', documentDate, { documentCode });
}

export async function nextCreditNoteNumber(documentDate, documentCode) {
  return nextCommercialDocumentNumber('credit_note', documentDate, { documentCode });
}

export async function nextDebitNoteNumber(documentDate, documentCode) {
  return nextCommercialDocumentNumber('debit_note', documentDate, { documentCode });
}

export async function nextDeliveryChallanNumber(documentDate, documentCode) {
  return nextCommercialDocumentNumber('delivery_challan', documentDate, { documentCode });
}

export async function nextBillOfSupplyNumber(documentDate, documentCode) {
  return nextCommercialDocumentNumber('bill_of_supply', documentDate, { documentCode });
}

async function orgCodeForRow(row) {
  const snapCode = normalizeDocumentCode(row?.orgSnapshot?.documentCode);
  if (snapCode) return snapCode;
  const live = await resolveOrgProfileId(row?.orgProfileId || 'default');
  return resolveOrgDocumentCode(live);
}

function applyParsedPeriod(row, number) {
  const parsed = parseDocumentNumber(number);
  if (parsed?.periodKey) {
    row.documentPeriod = parsed.periodKey;
    row.fiscalYear = parsed.fy;
    return;
  }
  const period = documentNumberPeriod(row.documentDate);
  row.documentPeriod = period.periodKey;
  row.fiscalYear = period.fy;
}

/** Assign official document number on approval (PREFIXFY/MM/SEQ). */
export async function assignCommercialDocumentNumber(row, { force = false } = {}) {
  const existing = trimStr(row.documentNumber);
  if (!force && existing) return existing;

  const documentCode = await orgCodeForRow(row);
  const requested = trimStr(row.requestedDocumentNumber);
  if (requested) {
    const canonical = validateManualDocumentNumber(requested, row.documentType, { documentCode });
    await assertDocumentNumberAvailable(canonical, { excludeId: row._id });
    row.documentNumber = canonical;
    applyParsedPeriod(row, canonical);
    return canonical;
  }

  let number = '';
  for (let attempt = 0; attempt < 12; attempt += 1) {
    number = await nextCommercialDocumentNumber(row.documentType, row.documentDate, { documentCode });
    try {
      await assertDocumentNumberAvailable(number, { excludeId: row._id });
      break;
    } catch (err) {
      if (err?.code !== 'CONFLICT' || attempt === 11) throw err;
      number = '';
    }
  }
  if (!number) {
    throw new AppError('Could not allocate a unique document number', 409, 'CONFLICT');
  }
  row.documentNumber = number;
  applyParsedPeriod(row, number);
  return number;
}

export async function correctIssuedDocumentNumber(row, { documentNumber, remark, actor } = {}) {
  const stage = String(row?.status || '');
  if (stage !== 'Issued') {
    throw new AppError('Only issued documents can have their number corrected', 400, 'VALIDATION_ERROR');
  }
  const note = trimStr(remark);
  if (!note) {
    throw new AppError('Correction remark is required', 400, 'VALIDATION_ERROR');
  }
  const documentCode = await orgCodeForRow(row);
  const canonical = validateManualDocumentNumber(documentNumber, row.documentType, { documentCode });
  if (numbersMatch(canonical, row.documentNumber)) {
    throw new AppError('Enter a different document number', 400, 'VALIDATION_ERROR');
  }
  await assertDocumentNumberAvailable(canonical, { excludeId: row._id });
  const previous = trimStr(row.documentNumber);
  const history = Array.isArray(row.documentNumberHistory) ? [...row.documentNumberHistory] : [];
  history.push({
    from: previous,
    to: canonical,
    remark: note,
    at: new Date().toISOString(),
    byId: actor?._id || null,
    byEmail: actor?.email || '',
  });
  row.documentNumberHistory = history;
  row.documentNumber = canonical;
  applyParsedPeriod(row, canonical);
  return row;
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

  const legal = orgProfile.legalName || '';
  const office = orgProfile.registeredOffice || '';
  const billingPlace =
    [orgProfile.state, orgProfile.stateCode ? `(${orgProfile.stateCode})` : null].filter(Boolean).join(' ') ||
    trimStr(body.billingPlaceOfSupply);

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
    // Buyer identity / tax / contacts always from Organisation master
    buyerCompanyName: trimStr(legal),
    buyerAddress: trimStr(office),
    buyerGstin: trimStr(orgProfile.gstin),
    buyerContactPerson: trimStr(body.buyerContactPerson),
    buyerMobile: trimStr(orgProfile.phone),
    buyerEmail: trimStr(orgProfile.email),
    vendorCode: trimStr(body.vendorCode),
    vendorMobile: trimStr(body.vendorMobile),
    vendorAddress: trimStr(body.vendorAddress || body.placeOfSupply),
    vendorGstin: trimStr(body.vendorGstin || body.recipientGstin),
    deliveryContact: trimStr(body.deliveryContact),
    deliveryMobile: trimStr(body.deliveryMobile),
    expectedDeliveryDate: trimStr(body.expectedDeliveryDate || body.dueDate),
    deliveryInstructions: trimStr(body.deliveryInstructions || body.shippingInstructions),
    billingAddress: [legal, office].filter(Boolean).join(', '),
    billingGstin: trimStr(orgProfile.gstin),
    billingState: trimStr(orgProfile.state),
    billingStateCode: trimStr(orgProfile.stateCode),
    billingPlaceOfSupply: billingPlace,
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
    roundOff: body.roundOff,
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
    clientPurchaseOrderId: trimStr(body.clientPurchaseOrderId) || null,
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
    placeOfSupply: trimStr(body.placeOfSupply || orgProfile.registeredOffice),
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
    // FROM identity / tax / contacts always from Organisation master
    fromCompanyName: trimStr(orgProfile.legalName),
    fromAddress: trimStr(orgProfile.registeredOffice),
    fromGstin: trimStr(orgProfile.gstin),
    fromContactPerson: trimStr(body.fromContactPerson),
    fromMobile: trimStr(orgProfile.phone),
    fromEmail: trimStr(orgProfile.email),
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
    roundOff: body.roundOff,
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

export async function nextQuotationNumber(documentDate, documentCode) {
  return nextCommercialDocumentNumber('quotation', documentDate, { documentCode });
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

export function assertEditableStatus(status, permissions) {
  const isAdmin = Boolean(permissions?.has?.(PERMISSIONS.ALL));
  if (isAdmin) return;
  if (!['Draft', 'Uploaded'].includes(status)) {
    throw new AppError(
      'This billing document is locked. Only Admin can edit it.',
      403,
      'DOCUMENT_LOCKED'
    );
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

/** Pre-GST (subtotal) minus 10% → Net Receivable. ₹100 → ₹90. */
export function netReceivableFromPreGst(subtotal) {
  const preGst = toAmount(subtotal);
  if (!(preGst > 0)) return 0;
  return toAmount(preGst * 0.9);
}

/** Calendar days from approvedAt (or issuedAt) to `now`. */
export function daysSinceDocumentApproved(row, now = new Date()) {
  const raw = row?.approvedAt || row?.issuedAt;
  if (!raw) return null;
  const start = new Date(raw);
  if (Number.isNaN(start.getTime())) return null;
  const end = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(end.getTime())) return null;
  const a = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const b = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.floor((b - a) / 86400000);
}

/** Canonical DB stage: Draft | Submitted | Issued | Cancelled. */
export function normalizeCommercialStage(status) {
  const raw = String(status || '').trim();
  if (!raw || raw === 'Uploaded') return 'Draft';
  if (raw === 'Approved') return 'Issued';
  if (raw === 'Drafting') return 'Draft';
  return raw;
}

/** UI Stage label — Draft/Uploaded → Drafting; Approved → Issued. */
export function displayCommercialStage(status) {
  const raw = String(status || '').trim() || 'Draft';
  const map = {
    Draft: 'Drafting',
    Uploaded: 'Drafting',
    Submitted: 'Submitted',
    Approved: 'Issued',
    Issued: 'Issued',
    Cancelled: 'Cancelled',
  };
  return map[raw] || raw;
}

export function isIssuedStage(status) {
  return ['Issued', 'Approved'].includes(String(status || '').trim());
}

/**
 * Document-specific Status (stored in paymentStatus; independent of Stage).
 */
export const COMMERCIAL_STATUS_BY_TYPE = {
  client_invoice: {
    mode: 'auto_invoice',
    options: ['Unpaid under 30D', 'Unpaid over 30D', 'Partially Paid', 'Paid'],
  },
  bill_of_supply: {
    mode: 'auto_invoice',
    options: ['Unpaid under 30D', 'Unpaid over 30D', 'Partially Paid', 'Paid'],
  },
  debit_note: {
    mode: 'auto_debit',
    default: 'Pending Collection',
    options: ['Pending Collection', 'Partially Paid', 'Paid'],
  },
  credit_note: {
    mode: 'manual',
    default: 'Pending Adjustment',
    options: ['Pending Adjustment', 'Partially Adjusted', 'Adjusted', 'Refunded'],
  },
  delivery_challan: {
    mode: 'manual',
    default: 'Ready for Dispatch',
    options: ['Ready for Dispatch', 'Dispatched', 'Delivered', 'Returned'],
  },
  proforma: {
    mode: 'manual',
    default: 'Sent',
    options: ['Sent', 'Accepted', 'Converted', 'Expired'],
  },
  purchase_order: {
    mode: 'manual',
    default: 'Open',
    options: ['Open', 'Partially Fulfilled', 'Fulfilled', 'Closed'],
  },
  quotation: {
    mode: 'manual',
    default: 'Sent',
    options: ['Sent', 'Under Review', 'Accepted', 'Rejected', 'Expired', 'Converted'],
  },
};

export function isManualLifecycleStatusType(documentType) {
  return COMMERCIAL_STATUS_BY_TYPE[documentType]?.mode === 'manual';
}

export function defaultLifecycleStatus(documentType) {
  return COMMERCIAL_STATUS_BY_TYPE[documentType]?.default || '';
}

/**
 * Ageing Status for Tax Invoice / Bill of Supply while unpaid.
 * ≤30 days → Unpaid under 30D · >30 → Unpaid over 30D
 */
export function paymentStatusFromAgeingDays(days) {
  if (days == null || !Number.isFinite(days) || days < 0) return 'Unpaid under 30D';
  if (days <= 30) return 'Unpaid under 30D';
  return 'Unpaid over 30D';
}

/** Normalize legacy + current stored payment/lifecycle Status values. */
export function normalizeStoredPaymentStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'unpaid') return 'Unpaid';
  if (raw === 'fully paid' || raw === 'paid' || raw === 'fully_paid') return 'Paid';
  if (raw === 'partially paid' || raw === 'partially_paid' || raw === 'partial') {
    return 'Partially Paid';
  }
  if (
    raw === 'invoice sent' ||
    raw === 'invoice due' ||
    raw === 'unpaid under 30d' ||
    raw === 'unpaid under 30 d'
  ) {
    return 'Unpaid under 30D';
  }
  if (
    raw === 'invoice overdue' ||
    raw === 'msme breach' ||
    raw === 'unpaid over 30d' ||
    raw === 'unpaid over 30 d'
  ) {
    return 'Unpaid over 30D';
  }
  return String(value || '').trim() || 'Unpaid';
}

function shouldShowLifecycleStatus(row) {
  const stage = normalizeCommercialStage(row?.status);
  return stage === 'Issued' || stage === 'Cancelled';
}

/**
 * Billing Center Status — document-type specific. Empty before Issued.
 * Paid / Partially Paid win for payment docs; otherwise ageing or stored manual.
 */
export function resolveCommercialDisplayStatus(row, now = new Date()) {
  if (!shouldShowLifecycleStatus(row)) return '';
  const type = row?.documentType;
  const cfg = COMMERCIAL_STATUS_BY_TYPE[type];
  if (!cfg) return '';

  const storedRaw = String(row?.paymentStatus || '').trim();
  const storedNorm = normalizeStoredPaymentStatus(storedRaw);

  if (cfg.mode === 'auto_invoice') {
    if (storedNorm === 'Paid') return 'Paid';
    if (storedNorm === 'Partially Paid') return 'Partially Paid';
    if (normalizeCommercialStage(row?.status) === 'Cancelled' && !row?.issuedAt && !row?.approvedAt) {
      return '';
    }
    const days = daysSinceDocumentApproved(row, now);
    return paymentStatusFromAgeingDays(days == null ? 0 : days);
  }

  if (cfg.mode === 'auto_debit') {
    if (storedNorm === 'Paid') return 'Paid';
    if (storedNorm === 'Partially Paid') return 'Partially Paid';
    return 'Pending Collection';
  }

  if (storedRaw && cfg.options.includes(storedRaw)) return storedRaw;
  if (storedNorm !== 'Unpaid' && cfg.options.includes(storedNorm)) return storedNorm;
  return cfg.default || '';
}

/** @deprecated Prefer resolveCommercialDisplayStatus */
export function resolveCommercialPaymentDisplayStatus(row, now = new Date()) {
  return resolveCommercialDisplayStatus(row, now);
}

/**
 * Seed default Status once when Issued if blank / Unpaid placeholder.
 * Does not change Stage.
 */
export function seedLifecycleStatusIfBlank(row) {
  const cfg = COMMERCIAL_STATUS_BY_TYPE[row?.documentType];
  if (!cfg?.default) return false;
  const current = String(row.paymentStatus || '').trim();
  if (current && cfg.options.includes(current)) return false;
  if (cfg.mode === 'manual' || cfg.mode === 'auto_debit') {
    row.paymentStatus = cfg.default;
    return true;
  }
  return false;
}

/**
 * Manual Status update — writes paymentStatus only; never mutates Stage.
 */
export function applyCommercialLifecycleStatus(row, statusInput) {
  const type = row?.documentType;
  const cfg = COMMERCIAL_STATUS_BY_TYPE[type];
  if (!cfg || cfg.mode !== 'manual') {
    throw new AppError(
      'This document type uses automatic Status; it cannot be set manually',
      400,
      'VALIDATION_ERROR'
    );
  }
  if (!isIssuedStage(row.status)) {
    throw new AppError(
      'Status can only be changed after the document is Issued',
      400,
      'VALIDATION_ERROR'
    );
  }
  const next = String(statusInput || '').trim();
  if (!cfg.options.includes(next)) {
    throw new AppError(
      `Invalid Status for this document type. Allowed: ${cfg.options.join(', ')}`,
      400,
      'VALIDATION_ERROR'
    );
  }
  row.paymentStatus = next;
  return row;
}

/**
 * Record a payment against an issued commercial document.
 * Same amount as Net Receivable → Paid; otherwise Partially Paid.
 * Does not change Stage.
 */
export function applyCommercialPayment(row, amountInput) {
  if (!isIssuedStage(row.status)) {
    throw new AppError('Only issued documents can record payment', 400, 'VALIDATION_ERROR');
  }
  const type = row.documentType;
  const mode = COMMERCIAL_STATUS_BY_TYPE[type]?.mode;
  if (mode !== 'auto_invoice' && mode !== 'auto_debit') {
    throw new AppError(
      'Payment recording is only for Tax Invoice, Bill of Supply, and Debit Note',
      400,
      'VALIDATION_ERROR'
    );
  }
  const amount = toAmount(amountInput);
  if (!(amount > 0)) {
    throw new AppError('Enter a payment amount greater than zero', 400, 'VALIDATION_ERROR');
  }
  const netReceivable = netReceivableFromPreGst(row.subtotal);
  if (!(netReceivable > 0)) {
    throw new AppError('Document has no Net Receivable amount to pay against', 400, 'VALIDATION_ERROR');
  }
  if (amount > netReceivable + 0.009) {
    throw new AppError('Payment cannot exceed Net Receivable', 400, 'VALIDATION_ERROR');
  }
  const fullyPaid = Math.abs(amount - netReceivable) < 0.01;
  row.paidAmount = amount;
  row.paymentStatus = fullyPaid ? 'Paid' : 'Partially Paid';
  row.paidAt = new Date().toISOString();
  return row;
}

export function assertRejectable(status) {
  if (status !== 'Submitted') {
    throw new AppError('Only submitted documents can be rejected', 400, 'VALIDATION_ERROR');
  }
}

/** Cancel allowed pre or post approval (any stage except already Cancelled). */
export function assertCancellable(status) {
  if (normalizeCommercialStage(status) === 'Cancelled' || status === 'Cancelled') {
    throw new AppError('Document is already cancelled', 400, 'VALIDATION_ERROR');
  }
}

/** Extra UI fields stored alongside normalized commercial payload */
export function extractBuilderExtras(body = {}) {
  const out = {};
  if (body.orgProfileId !== undefined) {
    out.orgProfileId = trimStr(body.orgProfileId) || 'default';
  }
  if (body.builderForm !== undefined) {
    // Keep org logo/QR/signature on FinanceOrgProfile only — never duplicate multi‑MB data-URLs per doc.
    // Issued docs keep orgSnapshot separately for historical integrity.
    out.builderForm =
      body.builderForm && typeof body.builderForm === 'object'
        ? stripBuilderFormMedia(body.builderForm)
        : null;
  }
  if (body.clientPurchaseOrderId !== undefined) {
    out.clientPurchaseOrderId = trimStr(body.clientPurchaseOrderId) || null;
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
