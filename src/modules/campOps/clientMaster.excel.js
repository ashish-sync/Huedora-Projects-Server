import { normalizeCampName } from './campOps.constants.js';

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
  'Request Timeline',
  'PO Amount',
  'Executed Camp Unit',
  'Cancelled Camp Unit',
  'OT Unit',
  'Minimum Patient Covered',
  'Minimum KMs Covered',
  'Ext Patient Unit',
  'KMs Unit',
  'Active',
];

/** Sample row uses the same values as the New Client Master form defaults/options. */
export const CLIENT_MASTER_SAMPLE_ROW = [
  'Acme Health',
  'Oncology Screening',
  'BMD',
  'HCW + Device',
  'Ravi Kumar',
  'Technician',
  '4:00',
  'Priya Shah',
  '9876543210',
  '5 Days Before',
  150000,
  10,
  1,
  2,
  120,
  500,
  15,
  25,
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
  requestTimeline: ['Request Timeline', 'requestTimeline'],
  poAmount: ['PO Amount', 'poAmount'],
  executedCampUnit: ['Executed Camp Unit', 'executedCampUnit'],
  cancelledCampUnit: ['Cancelled Camp Unit', 'cancelledCampUnit'],
  otUnit: ['OT Unit', 'otUnit'],
  minimumPatientCovered: ['Minimum Patient Covered', 'Min Patients', 'minimumPatientCovered'],
  minimumKmsCovered: ['Minimum KMs Covered', 'Min KMs', 'minimumKmsCovered'],
  extPatientUnit: ['Ext Patient Unit', 'extPatientUnit'],
  kmsUnit: ['KMs Unit', 'kmsUnit'],
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

  return {
    clientName,
    programName,
    campName,
    campType,
    coordinatorName: cellValue(row, IMPORT_ALIASES.coordinatorName),
    healthcareWorker: cellValue(row, IMPORT_ALIASES.healthcareWorker),
    campDuration: normalizeClientMasterDuration(cellValue(row, IMPORT_ALIASES.campDuration)),
    spocName: cellValue(row, IMPORT_ALIASES.spocName),
    spocNumber: cellValue(row, IMPORT_ALIASES.spocNumber),
    requestTimeline: cellValue(row, IMPORT_ALIASES.requestTimeline),
    poAmount: parseNumber(cellValue(row, IMPORT_ALIASES.poAmount)),
    executedCampUnit: parseNumber(cellValue(row, IMPORT_ALIASES.executedCampUnit)),
    cancelledCampUnit: parseNumber(cellValue(row, IMPORT_ALIASES.cancelledCampUnit)),
    otUnit: parseNumber(cellValue(row, IMPORT_ALIASES.otUnit)),
    minimumPatientCovered: parseNumber(cellValue(row, IMPORT_ALIASES.minimumPatientCovered)),
    minimumKmsCovered: parseNumber(cellValue(row, IMPORT_ALIASES.minimumKmsCovered)),
    extPatientUnit: parseNumber(cellValue(row, IMPORT_ALIASES.extPatientUnit)),
    kmsUnit: parseNumber(cellValue(row, IMPORT_ALIASES.kmsUnit)),
    isActive: !['no', 'false', '0', 'inactive'].includes(
      cellValue(row, IMPORT_ALIASES.isActive).toLowerCase()
    ),
  };
}

export function clientMasterToExcelRow(record) {
  return [
    record.clientName,
    record.programName,
    record.campName,
    record.campType,
    record.coordinatorName,
    record.healthcareWorker,
    record.campDuration,
    record.spocName,
    record.spocNumber,
    record.requestTimeline,
    record.poAmount,
    record.executedCampUnit,
    record.cancelledCampUnit,
    record.otUnit,
    record.minimumPatientCovered,
    record.minimumKmsCovered,
    record.extPatientUnit,
    record.kmsUnit,
    record.isActive === false ? 'No' : 'Yes',
  ];
}
