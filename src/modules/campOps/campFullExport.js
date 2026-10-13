import { formatDate, formatDateTime, formatTimeOfDay } from '../../utils/dateFormat.js';
import { formatConsumablesUsedSummary } from './campConsumables.js';
import {
  CAMP_EXPORT_SAMPLE_ROW,
  CAMP_SOURCE_LABELS,
  getCampExportColumns,
} from './campExportFieldSchema.js';
import {
  CAMP_LIFECYCLE_STAGES,
  computeLifecycleDerived,
  normalizeExecutionDocType,
  withCampLifecycle,
} from './campOps.lifecycle.js';
import { withRequestReview, REQUEST_REVIEW_LABELS } from './campOps.requestReview.js';
import { withCampSchedule } from './campOps.helpers.js';

const LIFECYCLE_STAGE_LABELS = Object.fromEntries(
  CAMP_LIFECYCLE_STAGES.map((stage) => [stage.id, stage.label]),
);

const PAYMENT_SUBMIT_LABELS = {
  payment_confirmed: 'Validation Completed',
  payment_not_checked: 'Validation Pending',
  payment_hold: 'Payment On Hold',
};

const FINANCE_PAYMENT_LABELS = {
  not_paid: 'Not Paid',
  under_review: 'Under Review',
  paid: 'Payment Completed',
};

const CANCELLED_BY_LABELS = {
  brand: 'Brand',
  khw: 'KHW',
};

export const CAMP_FULL_EXPORT_COLUMNS = getCampExportColumns();

export function resolveExportColumns(columnKeys) {
  const all = getCampExportColumns();
  if (!Array.isArray(columnKeys) || !columnKeys.length) return all;
  const allowed = new Set(columnKeys.map((key) => String(key || '').trim()).filter(Boolean));
  const selected = all.filter((column) => allowed.has(column.key));
  return selected.length ? selected : all;
}

/** Export dates as DD-MM-YYYY; datetimes as DD-MM-YYYY HH:mm (24-hour). */
function formatExportDate(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const formatted = formatDate(text);
    return formatted === '-' ? text : formatted;
  }
  if (/[T\s]\d{1,2}:\d{2}/.test(text) || /^\d{4}-\d{2}-\d{2}.+/.test(text)) {
    const formatted = formatDateTime(text);
    return formatted === '-' ? text : formatted;
  }
  const formatted = formatDate(text);
  return formatted === '-' ? text : formatted;
}

function formatExportTime(value) {
  if (!value) return '';
  return formatTimeOfDay(value) || String(value).trim();
}

function formatTimeFrameRange(startTime = '', endTime = '') {
  const start = formatExportTime(startTime);
  const end = formatExportTime(endTime);
  if (start && end) return `${start} – ${end}`;
  return start || end || '';
}

function countExecutionDocs(docs = [], targetType) {
  return docs.filter((doc) => normalizeExecutionDocType(doc?.docType) === targetType).length;
}

export function prepareCampForFullExport(camp = {}) {
  const base = camp?.toObject ? camp.toObject() : { ...camp };
  const enriched = withRequestReview(withCampLifecycle(withCampSchedule(base)));
  const derived = computeLifecycleDerived(enriched);
  const docs = Array.isArray(enriched.executionDocuments) ? enriched.executionDocuments : [];
  const source = String(enriched.source || '').trim();

  return {
    ...enriched,
    ...derived,
    status: String(enriched.status || '').replaceAll('_', ' '),
    lifecycleStage: LIFECYCLE_STAGE_LABELS[enriched.lifecycleStage] || enriched.lifecycleStage || '',
    requestReviewStatusLabel: enriched.requestReviewStatusLabel
      || REQUEST_REVIEW_LABELS[enriched.requestReviewStatus]
      || '',
    sourceLabel: CAMP_SOURCE_LABELS[source] || source,
    requestDate: formatExportDate(enriched.requestDate),
    campDate: formatExportDate(enriched.campDate),
    startTime: formatExportTime(enriched.startTime),
    endTime: formatExportTime(enriched.endTime),
    inTime: formatExportTime(enriched.inTime),
    outTime: formatExportTime(enriched.outTime),
    timeFrameRange: formatTimeFrameRange(enriched.startTime, enriched.endTime),
    cancelledByLabel: CANCELLED_BY_LABELS[enriched.cancelledBy] || enriched.cancelledBy || '',
    patientsCount: enriched.patientsCount ?? enriched.actualPatients ?? 0,
    paymentSubmitStatus: PAYMENT_SUBMIT_LABELS[enriched.paymentSubmitStatus]
      || enriched.paymentSubmitStatus
      || '',
    financePaymentStatus: FINANCE_PAYMENT_LABELS[enriched.financePaymentStatus]
      || enriched.financePaymentStatus
      || '',
    executedAt: formatExportDate(enriched.executedAt),
    submittedAt: formatExportDate(enriched.submittedAt),
    submittedToFinanceAt: formatExportDate(enriched.submittedToFinanceAt),
    financeProcessedAt: formatExportDate(enriched.financeProcessedAt),
    doctorFormCount: countExecutionDocs(docs, 'doctor_form'),
    patientFormCount: countExecutionDocs(docs, 'patient_form'),
    otherDocCount: countExecutionDocs(docs, 'other'),
    gpsSelfieCount: countExecutionDocs(docs, 'gps_selfie'),
    consumablesUsedSummary: formatConsumablesUsedSummary(enriched.consumablesUsed),
  };
}

export function buildCampFullExportRow(camp = {}, columns = CAMP_FULL_EXPORT_COLUMNS) {
  const values = prepareCampForFullExport(camp);
  return columns.map((column) => {
    const value = values[column.key];
    if (value == null) return '';
    if (Array.isArray(value)) return value.length;
    if (typeof value === 'object') return '';
    return value;
  });
}

export function campFullExportHeaders(columns = CAMP_FULL_EXPORT_COLUMNS) {
  return columns.map((column) => column.label);
}

export function campFullExportRows(camps = [], columns = CAMP_FULL_EXPORT_COLUMNS) {
  return camps.map((camp) => buildCampFullExportRow(camp, columns));
}

export function campFullExportSampleRow(columns = CAMP_FULL_EXPORT_COLUMNS) {
  return columns.map((column) => {
    const value = CAMP_EXPORT_SAMPLE_ROW[column.key];
    return value == null ? '' : value;
  });
}
