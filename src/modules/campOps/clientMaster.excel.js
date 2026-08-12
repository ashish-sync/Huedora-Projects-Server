import { normalizeCampName } from './campOps.constants.js';
import { normalizeHealthcareWorkers, formatHealthcareWorkers } from './healthcareWorkers.js';
import { parseAssignedUserEmails } from './campOps.clientAccess.js';
import { normalizeMappedConsumables } from './clientMasterConsumables.js';
import { LogisticsProduct, LogisticsUom } from '../logistics/logistics.model.js';

/**
 * Canonical Client Master columns — identical for Manual Form labels,
 * Sample Download, Data Download (export), and Excel Upload (import).
 * Order matches ClientMasterFormPage field order.
 */
export const CLIENT_MASTER_HEADERS = [
  'Client Name',
  'Client Code',
  'Status',
  'Billing Address',
  'State',
  'State Code',
  'GSTIN',
  'PAN',
  'Division / Therapy',
  'Display Name',
  'Method',
  'Service Model',
  'Healthcare Worker',
  'Camp Duration',
  'SPOC Name',
  'SPOC Number',
  'SPOC Email Address',
  'Request Timeline',
  'Assigned User Login Emails',
  'Executed Camp Unit',
  'Cancelled Camp Unit',
  'OT Unit',
  'Minimum Patient Covered',
  'Minimum Kms Covered',
  'Ext. Patient Unit',
  'Kms Unit',
  'Mapped Consumables',
  'Camp Terms',
  'PO Number',
  'PO Net Value',
  'PO Apply 18% GST',
  'PO Issue Date',
  'PO Expiry Date',
  'Agreement Start Date',
  'Agreement Effective Date',
  'Agreement End Date',
];

/** Sample row — same defaults/options as New Client Master form. */
export const CLIENT_MASTER_SAMPLE_ROW = [
  'Acme Health',
  'ACMEHEALTH',
  'Active',
  '12 Sample Road, Pune, Maharashtra 411001',
  'Maharashtra',
  '27',
  '27AABCU9603R1ZM',
  'AABCU9603R',
  'Oncology Screening',
  'Oncology BMD',
  'BMD',
  'HCW + Device (Light Device)',
  'Technician',
  '4:00',
  'Priya Shah',
  '9876543210',
  'priya.shah@client.com',
  '5 Days Before',
  'user@client.com, ops@client.com',
  10,
  1,
  2,
  120,
  500,
  15,
  25,
  '',
  'PO Based',
  'PO/2026/001',
  100000,
  'Yes',
  '2026-01-15',
  '2026-12-31',
  '',
  '',
  '',
];

const IMPORT_ALIASES = {
  clientName: ['Client Name', 'Client', 'clientName'],
  clientCode: ['Client Code', 'Code', 'clientCode'],
  displayName: ['Display Name', 'displayName'],
  isActive: ['Status', 'Active', 'isActive'],
  billingAddress: ['Billing Address', 'Billing address', 'address', 'billingAddress'],
  billingStateName: ['State', 'Billing State', 'billingStateName', 'stateName'],
  billingStateCode: ['State Code', 'State code', 'billingStateCode', 'stateCode'],
  billingGstin: ['GSTIN', 'billingGstin', 'gstin'],
  billingPan: ['PAN', 'billingPan', 'pan', 'panNumber'],
  programName: ['Division / Therapy', 'Program Name', 'Division', 'programName'],
  campName: ['Method', 'Camp Name', 'campName'],
  campType: ['Service Model', 'Camp Type', 'campType'],
  healthcareWorker: ['Healthcare Worker', 'HCW', 'healthcareWorker'],
  campDuration: ['Camp Duration', 'Duration', 'campDuration'],
  spocName: ['SPOC Name', 'spocName'],
  spocNumber: ['SPOC Number', 'spocNumber'],
  spocEmail: ['SPOC Email Address', 'SPOC Email', 'spocEmail'],
  requestTimeline: ['Request Timeline', 'requestTimeline'],
  assignedUserEmails: [
    'Assigned User Login Emails',
    'Assigned user login emails',
    'Assigned User Emails',
    'User Emails',
    'Login Emails',
    'assignedUserEmails',
  ],
  executedCampUnit: ['Executed Camp Unit', 'executedCampUnit'],
  cancelledCampUnit: ['Cancelled Camp Unit', 'cancelledCampUnit'],
  otUnit: ['OT Unit', 'otUnit'],
  minimumPatientCovered: ['Minimum Patient Covered', 'Min Patients', 'minimumPatientCovered'],
  minimumKmsCovered: ['Minimum Kms Covered', 'Minimum KMs Covered', 'Min KMs', 'minimumKmsCovered'],
  extPatientUnit: ['Ext. Patient Unit', 'Ext Patient Unit', 'extPatientUnit'],
  kmsUnit: ['Kms Unit', 'KMs Unit', 'kmsUnit'],
  mappedConsumables: ['Mapped Consumables', 'Consumables', 'mappedConsumables'],
  campTerms: ['Camp Terms', 'campTerms'],
  poNumbers: ['PO Number', 'PO Numbers', 'PO No.', 'poNumber', 'poNumbers'],
  poNetValues: ['PO Net Value', 'PO Net Values', 'PO Value', 'poNetValue', 'poNetValues'],
  poApplyGst18: ['PO Apply 18% GST', 'Apply 18% GST', 'poApplyGst18'],
  poIssueDate: ['PO Issue Date', 'PO Issue', 'poIssueDate'],
  poExpiryDate: ['PO Expiry Date', 'PO Expiry', 'poExpiryDate'],
  agreementStartDate: ['Agreement Start Date', 'Agreement Start', 'Start date', 'agreementStartDate'],
  agreementEffectiveDate: [
    'Agreement Effective Date',
    'Agreement Effective',
    'Effective date',
    'agreementEffectiveDate',
  ],
  agreementEndDate: ['Agreement End Date', 'Agreement End', 'End date', 'agreementEndDate'],
};

export function normalizeClientMasterDuration(value) {
  const raw = String(value || '').trim();
  if (!raw) return '4:00';
  if (/^\d{1,2}:[0-5]\d$/.test(raw)) return raw;
  const hoursOnly = raw.match(/^(\d{1,2})(?:\s*(?:hours?|hrs?))?$/i);
  if (hoursOnly) return `${String(hoursOnly[1]).padStart(2, '0')}:00`;
  return raw;
}

function cellValue(row, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const n of list) {
    if (row[n] !== undefined && String(row[n]).trim() !== '') return String(row[n]).trim();
  }
  const keys = Object.keys(row);
  for (const name of list) {
    const want = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
    const hit = keys.find((k) => k.toLowerCase().replace(/[^a-z0-9]/g, '') === want);
    if (hit && String(row[hit]).trim() !== '') return String(row[hit]).trim();
  }
  return '';
}

function parseNumber(value) {
  const n = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function splitList(value) {
  return String(value || '')
    .split(/[;\n|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseBoolToken(value) {
  return ['yes', 'true', '1', 'y'].includes(String(value || '').trim().toLowerCase());
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function buildPurchaseOrdersFromImport(numbersRaw, netsRaw, gstRaw) {
  const numbers = splitList(numbersRaw);
  const nets = splitList(netsRaw);
  const gstFlags = splitList(gstRaw);
  const count = Math.max(numbers.length, nets.length, gstFlags.length);
  if (!count) return [];

  const orders = [];
  for (let i = 0; i < count; i += 1) {
    const net = parseNumber(nets[i] ?? nets[0] ?? 0);
    const apply = parseBoolToken(gstFlags[i] ?? gstFlags[0] ?? '');
    const gst = apply ? roundMoney(net * 0.18) : 0;
    orders.push({
      id: `po-import-${i + 1}`,
      poNumber: numbers[i] || numbers[0] || '',
      poNetValue: net,
      poApplyGst18: apply,
      poGstAmount: gst,
      poGrossValue: roundMoney(net + gst),
      poFile: null,
    });
  }
  return orders;
}

function resolvePurchaseOrders(record) {
  if (Array.isArray(record?.purchaseOrders) && record.purchaseOrders.length) {
    return record.purchaseOrders;
  }
  if (record?.poNumber || record?.poNetValue || record?.poApplyGst18) {
    const net = Number(record.poNetValue) || 0;
    const apply = Boolean(record.poApplyGst18);
    const gst = apply ? roundMoney(net * 0.18) : 0;
    return [
      {
        poNumber: record.poNumber || '',
        poNetValue: net,
        poApplyGst18: apply,
        poGstAmount: record.poGstAmount ?? gst,
        poGrossValue: record.poGrossValue ?? roundMoney(net + gst),
      },
    ];
  }
  return [];
}

function normalizeCampTermsImport(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (raw === 'po' || raw === 'po_based' || raw === 'pobased') return 'po_based';
  if (raw === 'agreement' || raw === 'agreement_based' || raw === 'agreementbased') {
    return 'agreement_based';
  }
  if (raw === 'approval' || raw === 'approval_based' || raw === 'approvalbased') {
    return 'approval_based';
  }
  if (raw === 'none' || !raw) return 'none';
  return 'none';
}

function campTermsLabel(value) {
  switch (normalizeCampTermsImport(value)) {
    case 'po_based':
      return 'PO Based';
    case 'agreement_based':
      return 'Agreement Based';
    case 'approval_based':
      return 'Approval Based';
    default:
      return 'None';
  }
}

function parseStatusActive(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return true;
  return !['no', 'false', '0', 'inactive'].includes(raw);
}

function formatMappedConsumables(rows = []) {
  return normalizeMappedConsumables(rows)
    .map((row) => row.itemName || row.productId)
    .filter(Boolean)
    .join('; ');
}

async function resolveMappedConsumablesFromNames(raw) {
  const names = splitList(raw);
  if (!names.length) return [];
  const [products, uoms] = await Promise.all([
    LogisticsProduct.find({
      isDeleted: false,
      isActive: true,
      productType: 'Consumable',
    }).limit(2000),
    LogisticsUom.find({ isDeleted: false, isActive: true }),
  ]);
  const uomById = Object.fromEntries(
    uoms.map((uom) => [String(uom._id), String(uom.name || uom.code || '').trim()])
  );
  const byName = new Map(
    products.map((p) => [String(p.name || '').trim().toLowerCase(), p])
  );
  const resolved = [];
  for (const name of names) {
    const hit = byName.get(name.toLowerCase());
    if (!hit) {
      throw new Error(`Mapped consumable not found in Product Master: ${name}`);
    }
    const uomId = hit.uomId ? String(hit.uomId) : '';
    resolved.push({
      productId: String(hit._id),
      itemName: hit.name || name,
      unit: uomById[uomId] || '',
      uomId,
    });
  }
  return normalizeMappedConsumables(resolved);
}

function cellPresent(row, names) {
  return cellValue(row, names) !== '';
}

function setIfPresent(target, key, value) {
  if (value === undefined || value === null) return;
  if (typeof value === 'string' && value.trim() === '') return;
  if (Array.isArray(value) && value.length === 0) return;
  target[key] = value;
}

/**
 * Parse one Excel/CSV row into a Client Master patch.
 * Blank cells are omitted (never emitted as '' / 0 / [] / 'none') so updates
 * cannot silently wipe existing data.
 */
export async function parseClientMasterImportRow(row) {
  const clientName = cellValue(row, IMPORT_ALIASES.clientName);
  if (!clientName) return null;

  const programName = cellValue(row, IMPORT_ALIASES.programName);
  if (!programName) {
    throw new Error('Division / Therapy is required');
  }

  const campType = cellValue(row, IMPORT_ALIASES.campType);
  if (!campType) {
    throw new Error('Service Model is required');
  }

  const campNameRaw = cellValue(row, IMPORT_ALIASES.campName) || 'BMD';
  const campName = normalizeCampName(campNameRaw);
  if (!campName || campName.toLowerCase() === 'others') {
    throw new Error('Method is required (select a method or specify Others)');
  }

  const poNumbersRaw = cellValue(row, IMPORT_ALIASES.poNumbers);
  const poNetsRaw = cellValue(row, IMPORT_ALIASES.poNetValues);
  const poGstRaw = cellValue(row, IMPORT_ALIASES.poApplyGst18);
  const purchaseOrders = buildPurchaseOrdersFromImport(poNumbersRaw, poNetsRaw, poGstRaw);

  const parsed = {
    clientName,
    programName,
    campName,
    campType,
  };

  setIfPresent(parsed, 'clientCode', cellValue(row, IMPORT_ALIASES.clientCode).toUpperCase());
  setIfPresent(parsed, 'displayName', cellValue(row, IMPORT_ALIASES.displayName));

  const billing = {};
  setIfPresent(billing, 'address', cellValue(row, IMPORT_ALIASES.billingAddress));
  setIfPresent(billing, 'stateName', cellValue(row, IMPORT_ALIASES.billingStateName));
  setIfPresent(billing, 'stateCode', cellValue(row, IMPORT_ALIASES.billingStateCode));
  setIfPresent(billing, 'gstin', cellValue(row, IMPORT_ALIASES.billingGstin).toUpperCase());
  setIfPresent(billing, 'pan', cellValue(row, IMPORT_ALIASES.billingPan).toUpperCase());
  if (Object.keys(billing).length) parsed.billing = billing;

  if (cellPresent(row, IMPORT_ALIASES.healthcareWorker)) {
    parsed.healthcareWorker = normalizeHealthcareWorkers(
      cellValue(row, IMPORT_ALIASES.healthcareWorker)
    );
  }
  if (cellPresent(row, IMPORT_ALIASES.campDuration)) {
    parsed.campDuration = normalizeClientMasterDuration(
      cellValue(row, IMPORT_ALIASES.campDuration)
    );
  }
  setIfPresent(parsed, 'spocName', cellValue(row, IMPORT_ALIASES.spocName));
  setIfPresent(parsed, 'spocNumber', cellValue(row, IMPORT_ALIASES.spocNumber));
  if (cellPresent(row, IMPORT_ALIASES.spocEmail)) {
    parsed.spocEmail = parseAssignedUserEmails(
      cellValue(row, IMPORT_ALIASES.spocEmail)
    ).join(', ');
  }
  setIfPresent(parsed, 'requestTimeline', cellValue(row, IMPORT_ALIASES.requestTimeline));

  if (cellPresent(row, IMPORT_ALIASES.assignedUserEmails)) {
    parsed.assignedUserEmails = cellValue(row, IMPORT_ALIASES.assignedUserEmails)
      .split(/[;,\n]/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
  }

  const numericFields = [
    ['executedCampUnit', IMPORT_ALIASES.executedCampUnit],
    ['cancelledCampUnit', IMPORT_ALIASES.cancelledCampUnit],
    ['otUnit', IMPORT_ALIASES.otUnit],
    ['minimumPatientCovered', IMPORT_ALIASES.minimumPatientCovered],
    ['minimumKmsCovered', IMPORT_ALIASES.minimumKmsCovered],
    ['extPatientUnit', IMPORT_ALIASES.extPatientUnit],
    ['kmsUnit', IMPORT_ALIASES.kmsUnit],
  ];
  for (const [key, aliases] of numericFields) {
    if (cellPresent(row, aliases)) parsed[key] = parseNumber(cellValue(row, aliases));
  }

  if (cellPresent(row, IMPORT_ALIASES.mappedConsumables)) {
    parsed.mappedConsumables = await resolveMappedConsumablesFromNames(
      cellValue(row, IMPORT_ALIASES.mappedConsumables)
    );
  }

  if (cellPresent(row, IMPORT_ALIASES.isActive)) {
    parsed.isActive = parseStatusActive(cellValue(row, IMPORT_ALIASES.isActive));
  }

  const campTermsRaw = cellValue(row, IMPORT_ALIASES.campTerms);
  let campTerms;
  if (campTermsRaw) {
    campTerms = normalizeCampTermsImport(campTermsRaw);
  } else if (purchaseOrders.length) {
    campTerms = 'po_based';
  } else if (
    cellPresent(row, IMPORT_ALIASES.agreementStartDate)
    || cellPresent(row, IMPORT_ALIASES.agreementEffectiveDate)
    || cellPresent(row, IMPORT_ALIASES.agreementEndDate)
  ) {
    campTerms = 'agreement_based';
  }
  if (campTerms) parsed.campTerms = campTerms;

  if (purchaseOrders.length) {
    const issue = cellValue(row, IMPORT_ALIASES.poIssueDate).slice(0, 10);
    const expiry = cellValue(row, IMPORT_ALIASES.poExpiryDate).slice(0, 10);
    parsed.purchaseOrders = purchaseOrders.map((po, index) => ({
      ...po,
      poIssueDate: index === 0 ? issue : po.poIssueDate || '',
      poExpiryDate: index === 0 ? expiry : po.poExpiryDate || '',
    }));
    const first = purchaseOrders[0];
    setIfPresent(parsed, 'poNumber', first.poNumber);
    if (first.poNetValue != null) parsed.poNetValue = first.poNetValue;
    parsed.poApplyGst18 = Boolean(first.poApplyGst18);
    setIfPresent(parsed, 'poIssueDate', issue);
    setIfPresent(parsed, 'poExpiryDate', expiry);
  } else {
    setIfPresent(parsed, 'poIssueDate', cellValue(row, IMPORT_ALIASES.poIssueDate).slice(0, 10));
    setIfPresent(parsed, 'poExpiryDate', cellValue(row, IMPORT_ALIASES.poExpiryDate).slice(0, 10));
  }

  setIfPresent(
    parsed,
    'agreementStartDate',
    cellValue(row, IMPORT_ALIASES.agreementStartDate).slice(0, 10)
  );
  setIfPresent(
    parsed,
    'agreementEffectiveDate',
    cellValue(row, IMPORT_ALIASES.agreementEffectiveDate).slice(0, 10)
  );
  setIfPresent(
    parsed,
    'agreementEndDate',
    cellValue(row, IMPORT_ALIASES.agreementEndDate).slice(0, 10)
  );

  return parsed;
}

/**
 * @param {object} record Client Master row
 * @param {object} [billing] Optional company billing view (gstin/pan/address/…)
 * @param {object} [client] Optional company ({ code })
 */
export function clientMasterToExcelRow(record, billing = {}, client = null) {
  const orders = resolvePurchaseOrders(record);
  const first = orders[0] || null;
  const bill = billing && typeof billing === 'object' ? billing : {};
  return [
    record.clientName || '',
    client?.code || record.clientCode || '',
    record.isActive === false ? 'Inactive' : 'Active',
    bill.address || '',
    bill.stateName || '',
    bill.stateCode || '',
    bill.gstin || '',
    bill.pan || '',
    record.programName || '',
    record.displayName || '',
    record.campName || '',
    record.campType || '',
    formatHealthcareWorkers(record.healthcareWorker),
    record.campDuration || '',
    record.spocName || '',
    record.spocNumber || '',
    record.spocEmail || '',
    record.requestTimeline || '',
    Array.isArray(record.assignedUserEmails)
      ? record.assignedUserEmails.join(', ')
      : (record.assignedUserEmails || ''),
    record.executedCampUnit ?? '',
    record.cancelledCampUnit ?? '',
    record.otUnit ?? '',
    record.minimumPatientCovered ?? '',
    record.minimumKmsCovered ?? '',
    record.extPatientUnit ?? '',
    record.kmsUnit ?? '',
    formatMappedConsumables(record.mappedConsumables),
    campTermsLabel(record.campTerms),
    orders.length > 1
      ? orders.map((o) => o.poNumber || '').filter(Boolean).join('; ')
      : (record.poNumber || first?.poNumber || ''),
    orders.length > 1
      ? orders.map((o) => o.poNetValue ?? 0).join('; ')
      : (record.poNetValue ?? first?.poNetValue ?? 0),
    orders.length > 1
      ? orders.map((o) => (o.poApplyGst18 ? 'Yes' : 'No')).join('; ')
      : ((record.poApplyGst18 ?? first?.poApplyGst18) ? 'Yes' : 'No'),
    record.poIssueDate || first?.poIssueDate || '',
    record.poExpiryDate || first?.poExpiryDate || '',
    record.agreementStartDate || '',
    record.agreementEffectiveDate || '',
    record.agreementEndDate || '',
  ];
}
