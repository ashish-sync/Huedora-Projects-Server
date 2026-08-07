import { normalizeCampName } from './campOps.constants.js';
import { normalizeHealthcareWorkers, formatHealthcareWorkers } from './healthcareWorkers.js';
import { parseAssignedUserEmails } from './campOps.clientAccess.js';

/** Excel columns aligned with Client Master form labels. */
export const CLIENT_MASTER_HEADERS = [
  'Client Name',
  'Division / Therapy',
  'Method',
  'Service Model',
  'Coordinator Name',
  'Healthcare Worker',
  'Camp Duration',
  'SPOC Name',
  'SPOC Number',
  'SPOC Email Address',
  'Request Timeline',
  'Camp Terms',
  'PO Number',
  'PO Net Value',
  'PO Apply 18% GST',
  'PO Expiry',
  'Agreement Start',
  'Agreement Effective',
  'Agreement End',
  'Executed Camp Unit',
  'Cancelled Camp Unit',
  'OT Unit',
  'Minimum Patient Covered',
  'Minimum KMs Covered',
  'Ext Patient Unit',
  'KMs Unit',
  'Assigned User Emails',
  'Active',
];

/** Sample row uses the same values as the New Client Master form defaults/options. */
export const CLIENT_MASTER_SAMPLE_ROW = [
  'Acme Health',
  'Oncology Screening',
  'BMD',
  'HCW + Device (Light Device)',
  'Ravi Kumar',
  'Technician',
  '4:00',
  'Priya Shah',
  '9876543210',
  'priya.shah@client.com',
  '5 Days Before',
  'PO Based',
  'PO/2026/001',
  100000,
  'Yes',
  '2026-12-31',
  '',
  '',
  '',
  10,
  1,
  2,
  120,
  500,
  15,
  25,
  'user@client.com, ops@client.com',
  'Yes',
];

const IMPORT_ALIASES = {
  clientName: ['Client Name', 'Client', 'clientName'],
  programName: ['Division / Therapy', 'Program Name', 'Division', 'programName'],
  campName: ['Method', 'Camp Name', 'campName'],
  campType: ['Service Model', 'Camp Type', 'campType'],
  coordinatorName: ['Coordinator Name', 'Coordinator', 'coordinatorName'],
  healthcareWorker: ['Healthcare Worker', 'HCW', 'healthcareWorker'],
  campDuration: ['Camp Duration', 'Duration', 'campDuration'],
  spocName: ['SPOC Name', 'spocName'],
  spocNumber: ['SPOC Number', 'spocNumber'],
  spocEmail: ['SPOC Email Address', 'SPOC Email', 'spocEmail'],
  requestTimeline: ['Request Timeline', 'requestTimeline'],
  campTerms: ['Camp Terms', 'campTerms'],
  poNumbers: ['PO Numbers', 'PO Number', 'poNumber', 'poNumbers'],
  poNetValues: ['PO Net Values', 'PO Net Value', 'poNetValue', 'poNetValues'],
  poApplyGst18: ['PO Apply 18% GST', 'Apply 18% GST', 'poApplyGst18'],
  poExpiryDate: ['PO Expiry', 'PO Expiry Date', 'poExpiryDate'],
  agreementStartDate: ['Agreement Start', 'agreementStartDate'],
  agreementEffectiveDate: ['Agreement Effective', 'agreementEffectiveDate'],
  agreementEndDate: ['Agreement End', 'agreementEndDate'],
  executedCampUnit: ['Executed Camp Unit', 'executedCampUnit'],
  cancelledCampUnit: ['Cancelled Camp Unit', 'cancelledCampUnit'],
  otUnit: ['OT Unit', 'otUnit'],
  minimumPatientCovered: ['Minimum Patient Covered', 'Min Patients', 'minimumPatientCovered'],
  minimumKmsCovered: ['Minimum KMs Covered', 'Min KMs', 'minimumKmsCovered'],
  extPatientUnit: ['Ext Patient Unit', 'extPatientUnit'],
  kmsUnit: ['KMs Unit', 'kmsUnit'],
  assignedUserEmails: ['Assigned User Emails', 'User Emails', 'Login Emails', 'assignedUserEmails'],
  isActive: ['Active', 'isActive'],
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

export function parseClientMasterImportRow(row) {
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

  const purchaseOrders = buildPurchaseOrdersFromImport(
    cellValue(row, IMPORT_ALIASES.poNumbers),
    cellValue(row, IMPORT_ALIASES.poNetValues),
    cellValue(row, IMPORT_ALIASES.poApplyGst18)
  );

  let campTerms = normalizeCampTermsImport(cellValue(row, IMPORT_ALIASES.campTerms));
  if (campTerms === 'none' && purchaseOrders.length) campTerms = 'po_based';
  if (
    campTerms === 'none'
    && (cellValue(row, IMPORT_ALIASES.agreementStartDate)
      || cellValue(row, IMPORT_ALIASES.agreementEffectiveDate)
      || cellValue(row, IMPORT_ALIASES.agreementEndDate))
  ) {
    campTerms = 'agreement_based';
  }

  const first = purchaseOrders[0] || null;
  const parsed = {
    clientName,
    programName,
    campName,
    campType,
    coordinatorName: cellValue(row, IMPORT_ALIASES.coordinatorName),
    healthcareWorker: normalizeHealthcareWorkers(cellValue(row, IMPORT_ALIASES.healthcareWorker)),
    campDuration: normalizeClientMasterDuration(cellValue(row, IMPORT_ALIASES.campDuration)),
    spocName: cellValue(row, IMPORT_ALIASES.spocName),
    spocNumber: cellValue(row, IMPORT_ALIASES.spocNumber),
    spocEmail: parseAssignedUserEmails(cellValue(row, IMPORT_ALIASES.spocEmail)).join(', '),
    requestTimeline: cellValue(row, IMPORT_ALIASES.requestTimeline),
    campTerms,
    poNumber: first?.poNumber || cellValue(row, IMPORT_ALIASES.poNumbers).split(/[;|]/)[0]?.trim() || '',
    poNetValue: first?.poNetValue ?? parseNumber(cellValue(row, IMPORT_ALIASES.poNetValues)),
    poApplyGst18: first
      ? Boolean(first.poApplyGst18)
      : parseBoolToken(cellValue(row, IMPORT_ALIASES.poApplyGst18)),
    poExpiryDate: cellValue(row, IMPORT_ALIASES.poExpiryDate).slice(0, 10),
    agreementStartDate: cellValue(row, IMPORT_ALIASES.agreementStartDate).slice(0, 10),
    agreementEffectiveDate: cellValue(row, IMPORT_ALIASES.agreementEffectiveDate).slice(0, 10),
    agreementEndDate: cellValue(row, IMPORT_ALIASES.agreementEndDate).slice(0, 10),
    executedCampUnit: parseNumber(cellValue(row, IMPORT_ALIASES.executedCampUnit)),
    cancelledCampUnit: parseNumber(cellValue(row, IMPORT_ALIASES.cancelledCampUnit)),
    otUnit: parseNumber(cellValue(row, IMPORT_ALIASES.otUnit)),
    minimumPatientCovered: parseNumber(cellValue(row, IMPORT_ALIASES.minimumPatientCovered)),
    minimumKmsCovered: parseNumber(cellValue(row, IMPORT_ALIASES.minimumKmsCovered)),
    extPatientUnit: parseNumber(cellValue(row, IMPORT_ALIASES.extPatientUnit)),
    kmsUnit: parseNumber(cellValue(row, IMPORT_ALIASES.kmsUnit)),
    assignedUserEmails: cellValue(row, IMPORT_ALIASES.assignedUserEmails)
      .split(/[;,\n]/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    isActive: !['no', 'false', '0', 'inactive'].includes(
      cellValue(row, IMPORT_ALIASES.isActive).toLowerCase()
    ),
  };
  if (purchaseOrders.length) {
    parsed.purchaseOrders = purchaseOrders;
  }
  return parsed;
}

export function clientMasterToExcelRow(record) {
  const orders = resolvePurchaseOrders(record);
  const first = orders[0] || null;
  return [
    record.clientName,
    record.programName,
    record.campName,
    record.campType,
    record.coordinatorName,
    formatHealthcareWorkers(record.healthcareWorker),
    record.campDuration,
    record.spocName,
    record.spocNumber,
    record.spocEmail,
    record.requestTimeline,
    campTermsLabel(record.campTerms),
    record.poNumber || first?.poNumber || '',
    record.poNetValue ?? first?.poNetValue ?? 0,
    (record.poApplyGst18 ?? first?.poApplyGst18) ? 'Yes' : 'No',
    record.poExpiryDate || '',
    record.agreementStartDate || '',
    record.agreementEffectiveDate || '',
    record.agreementEndDate || '',
    record.executedCampUnit,
    record.cancelledCampUnit,
    record.otUnit,
    record.minimumPatientCovered,
    record.minimumKmsCovered,
    record.extPatientUnit,
    record.kmsUnit,
    Array.isArray(record.assignedUserEmails)
      ? record.assignedUserEmails.join(', ')
      : (record.assignedUserEmails || ''),
    record.isActive === false ? 'No' : 'Yes',
  ];
}
