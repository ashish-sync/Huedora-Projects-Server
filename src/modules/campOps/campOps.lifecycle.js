import { normalizeConsumablesUsed, getConsumablesCompletionBlockers } from './campConsumables.js';
import {
  parseTimeToMinutes,
  computeDurationHours,
  getCampStartDateTime,
  getCampEndDateTime,
} from './campOps.helpers.js';
import { localTodayIso } from './campDatePolicy.js';
import { computeCampRevenueFromPricing } from './campOps.clientMasterPricing.js';
import { clearCampHcwAssignment } from './hcwAssignmentGap.js';

function localTrim(v) {
  return v == null ? '' : String(v).trim();
}

export const CAMP_LIFECYCLE_STAGES = [
  { id: 'request', label: 'Request Stage', short: 'Request' },
  { id: 'assignment', label: 'Resource Assignment', short: 'Assignment' },
  { id: 'execution', label: 'Camp Execution', short: 'Execution' },
  { id: 'financial', label: 'Finance & Settlement', short: 'Financial' },
];

export function normalizeLifecycleStage(stage, fallback = 'request') {
  const raw = localTrim(stage);
  if (!raw) return fallback;
  const byId = CAMP_LIFECYCLE_STAGES.find((s) => s.id === raw);
  if (byId) return byId.id;
  const lower = raw.toLowerCase();
  const byLowerId = CAMP_LIFECYCLE_STAGES.find((s) => s.id === lower);
  if (byLowerId) return byLowerId.id;
  const byShort = CAMP_LIFECYCLE_STAGES.find(
    (s) => s.short.toLowerCase() === lower || s.label.toLowerCase() === lower,
  );
  if (byShort) return byShort.id;
  return fallback;
}

export function lifecycleStageIndex(stage) {
  return CAMP_LIFECYCLE_STAGES.findIndex((s) => s.id === normalizeLifecycleStage(stage, ''));
}

export function hasReachedLifecycleStage(reachedStage, targetStage) {
  const reached = lifecycleStageIndex(reachedStage || 'request');
  const target = lifecycleStageIndex(targetStage);
  if (reached < 0 || target < 0) return false;
  return target <= reached;
}

export function maxLifecycleStage(a, b) {
  const ai = lifecycleStageIndex(a || 'request');
  const bi = lifecycleStageIndex(b || 'request');
  if (ai < 0) return normalizeLifecycleStage(b, 'request');
  if (bi < 0) return normalizeLifecycleStage(a, 'request');
  return ai >= bi
    ? normalizeLifecycleStage(a, 'request')
    : normalizeLifecycleStage(b, 'request');
}

export const CAMP_SLOTS = ['Morning', 'Noon', 'Evening'];

export const ASSIGNMENT_DECISIONS = ['assign', 'refuse'];

export const ASSIGNMENT_REFUSAL_REASONS = [
  'Refused',
];

export const ASSIGNMENT_STATUSES = ['Pending', 'Assigned', 'Reassigned', 'Unassigned'];

export const EXECUTION_STATUS = {
  CAMP_SCHEDULED: 'Camp Scheduled',
  CAMP_ONGOING: 'Camp Ongoing',
  CAMP_COMPLETED: 'Camp Completed',
  MARKED_EXECUTED: 'Marked Executed',
};

export const EXECUTION_STATUSES = [
  EXECUTION_STATUS.CAMP_SCHEDULED,
  EXECUTION_STATUS.CAMP_ONGOING,
  EXECUTION_STATUS.MARKED_EXECUTED,
  EXECUTION_STATUS.CAMP_COMPLETED,
];

export const LEGACY_EXECUTION_CLOSED_STATUSES = ['Cancelled', 'Refused'];

/** Closure Type values that also serve as Execution Status. */
export const EXECUTION_CANCELLATION_STATUSES = [
  'Cancelled by Tylo',
  'Cancelled by Client',
];

const LEGACY_EXECUTION_STATUS_ALIASES = {
  Pending: EXECUTION_STATUS.CAMP_SCHEDULED,
  'Yet to Start': EXECUTION_STATUS.CAMP_SCHEDULED,
  'In Progress': EXECUTION_STATUS.CAMP_ONGOING,
  Ongoing: EXECUTION_STATUS.CAMP_ONGOING,
  Executed: EXECUTION_STATUS.MARKED_EXECUTED,
  Completed: EXECUTION_STATUS.CAMP_COMPLETED,
  'Cancelled by TCPL': 'Cancelled by Tylo',
};

export function normalizeExecutionStatus(executionStatus) {
  const value = String(executionStatus || '').trim();
  if (value === 'Rejected') return 'Refused';
  if (LEGACY_EXECUTION_STATUS_ALIASES[value]) return LEGACY_EXECUTION_STATUS_ALIASES[value];
  return value;
}

export function isExecutionClosedOut(executionStatus) {
  const normalized = normalizeExecutionStatus(executionStatus);
  return LEGACY_EXECUTION_CLOSED_STATUSES.includes(normalized)
    || EXECUTION_CANCELLATION_STATUSES.includes(normalized);
}

export function isExecutionCancellationStatus(executionStatus) {
  return EXECUTION_CANCELLATION_STATUSES.includes(normalizeExecutionStatus(executionStatus));
}

/** Cancelled-by closure camps advance to Finance without execution completion fields. */
export function isExecutionCancellationForFinance(camp = {}) {
  if (isExecutionCancellationStatus(camp.executionStatus)) return true;
  const reason = normalizeExecutionStatus(camp.assignmentRefusalReason || '');
  if (EXECUTION_CANCELLATION_STATUSES.includes(reason)) return true;
  if (String(camp.status || '').trim() === 'cancelled') {
    if (camp.cancelledBy === 'brand') return true;
    if (camp.cancelledBy === 'khw') return true;
  }
  return false;
}

export function resolveCancelledClosureExecutionStatus(camp = {}) {
  if (isExecutionCancellationStatus(camp.executionStatus)) {
    return normalizeExecutionStatus(camp.executionStatus);
  }
  const reason = normalizeExecutionStatus(camp.assignmentRefusalReason || '');
  if (EXECUTION_CANCELLATION_STATUSES.includes(reason)) return reason;
  if (String(camp.status || '').trim() === 'cancelled') {
    if (camp.cancelledBy === 'brand') return 'Cancelled by Client';
    if (camp.cancelledBy === 'khw') return 'Cancelled by Tylo';
  }
  return '';
}

export function resolveScheduledExecutionStatus(camp = {}, now = new Date()) {
  void camp;
  void now;
  return EXECUTION_STATUS.CAMP_SCHEDULED;
}

export function resolveEffectiveExecutionStatus(camp = {}, now = new Date()) {
  const closureStatus = resolveCancelledClosureExecutionStatus(camp);
  if (closureStatus) return closureStatus;
  const normalized = normalizeExecutionStatus(camp.executionStatus);
  if (normalized === EXECUTION_STATUS.CAMP_COMPLETED) return EXECUTION_STATUS.CAMP_COMPLETED;
  if (isExecutionClosedOut(normalized)) return normalized;
  if (
    normalized === EXECUTION_STATUS.MARKED_EXECUTED
    || normalized === EXECUTION_STATUS.CAMP_ONGOING
    || normalized === EXECUTION_STATUS.CAMP_SCHEDULED
  ) {
    return normalized;
  }
  return resolveScheduledExecutionStatus(camp, now);
}

export function syncExecutionStatusForSave(camp = {}, now = new Date()) {
  const normalized = normalizeExecutionStatus(camp.executionStatus);
  if (normalized === EXECUTION_STATUS.CAMP_COMPLETED) return EXECUTION_STATUS.CAMP_COMPLETED;
  if (isExecutionClosedOut(normalized)) return normalized;
  return resolveScheduledExecutionStatus(camp, now);
}

/** Execution is complete enough to open Finance & Settlement. */
export function normalizeExecutionDocType(docType) {
  const raw = String(docType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (raw === 'doctor_form' || raw === 'df' || raw.includes('doctor')) return 'doctor_form';
  if (raw === 'patient_form' || raw === 'pf' || raw.includes('patient')) return 'patient_form';
  return raw;
}

function hasExecutionDocType(docs, targetType) {
  return (docs || []).some((doc) => normalizeExecutionDocType(doc?.docType) === targetType);
}

export function getMarkExecutedFieldBlockers(camp = {}) {
  const blockers = [];
  if (!localTrim(camp.chargeableStatus)) blockers.push('Select Chargeable Status');
  if (!localTrim(camp.inTime)) blockers.push('Enter In Time');
  if (!localTrim(camp.attire)) blockers.push('Select Attire');
  return blockers;
}

export function assertCanMarkCampExecuted(camp = {}, now = new Date()) {
  if (camp.assignmentDecision !== 'assign' || !camp.hcwContactId) {
    throw new Error('Assign a healthcare worker before marking the camp executed');
  }
  const fieldBlockers = getMarkExecutedFieldBlockers(camp);
  if (fieldBlockers.length) {
    throw new Error(fieldBlockers[0]);
  }
  void now;
}

export function getExecutionFinanceBlockers(camp = {}, mappedConsumables = []) {
  if (isExecutionCancellationForFinance(camp)) {
    return [];
  }
  const blockers = [];
  if (isExecutionClosedOut(camp.executionStatus)) {
    blockers.push('Execution is cancelled or refused');
    return blockers;
  }
  const execStatus = normalizeExecutionStatus(camp.executionStatus);
  if (
    execStatus !== EXECUTION_STATUS.CAMP_COMPLETED
    && execStatus !== EXECUTION_STATUS.MARKED_EXECUTED
  ) {
    blockers.push('Complete Chargeable Status, In Time, and Attire (move to Executed) before Mark Complete');
  }
  if (!localTrim(camp.chargeableStatus)) {
    blockers.push('Select chargeable status');
  }
  if (!localTrim(camp.inTime)) {
    blockers.push('Enter in time on the execution form');
  }
  if (!localTrim(camp.attire)) {
    blockers.push('Select attire on the execution form');
  }
  if (!localTrim(camp.outTime)) {
    blockers.push('Enter out time on the execution form');
  }
  if (camp.kmRoundTrip === '' || camp.kmRoundTrip == null || Number.isNaN(Number(camp.kmRoundTrip))) {
    blockers.push('Enter Travelled Kms (Round Trip)');
  }
  const patients = camp.actualPatients ?? camp.patientsCount;
  if (patients === '' || patients == null || Number.isNaN(Number(patients))) {
    blockers.push('Enter Patients Screened');
  }
  if (camp.rxCount === '' || camp.rxCount == null || Number.isNaN(Number(camp.rxCount))) {
    blockers.push('Enter Product Count');
  }
  const docs = Array.isArray(camp.executionDocuments) ? camp.executionDocuments : [];
  if (!hasExecutionDocType(docs, 'doctor_form')) {
    blockers.push('Upload at least one DF (doctor form) document');
  }
  if (!hasExecutionDocType(docs, 'patient_form')) {
    blockers.push('Upload at least one PF (patient form) document');
  }
  blockers.push(...getExecutionConsumablesBlockers(camp, mappedConsumables));
  return blockers;
}

export function getExecutionConsumablesBlockers(camp = {}, mappedConsumables = []) {
  if (isExecutionCancellationForFinance(camp)) return [];
  if (!Array.isArray(mappedConsumables) || !mappedConsumables.length) return [];
  const normalized = normalizeExecutionStatus(camp.executionStatus);
  const effective = normalized === EXECUTION_STATUS.CAMP_COMPLETED
    ? EXECUTION_STATUS.CAMP_COMPLETED
    : isExecutionClosedOut(normalized)
      ? normalized
      : resolveScheduledExecutionStatus(camp);
  if (effective === EXECUTION_STATUS.CAMP_SCHEDULED) return [];
  return getConsumablesCompletionBlockers(mappedConsumables, camp.consumablesUsed);
}

export function assertExecutionConsumablesComplete(camp = {}, mappedConsumables = []) {
  const blockers = getExecutionConsumablesBlockers(camp, mappedConsumables);
  if (blockers.length) {
    throw new Error(blockers[0]);
  }
}

export function isExecutionReadyForFinance(camp = {}, mappedConsumables = []) {
  return getExecutionFinanceBlockers(camp, mappedConsumables).length === 0;
}

export function assertExecutionStageSave(camp = {}) {
  if (!isExecutionClosedOut(camp.executionStatus)) return;
  if (!localTrim(camp.cancellationReason)) {
    throw new Error(
      'Cancellation / Refusal Reason is required when execution status is Cancelled or Refused',
    );
  }
}

export const CHARGEABLE_STATUSES = ['Chargeable', 'Non-Chargeable', 'Partial'];

export const QUALITY_RATINGS = ['Good', 'Average', 'Poor'];

export const ATTIRE_CHECK_OPTIONS = ['No Issues', 'Issues'];

export const HCW_CATEGORIES = [
  'Doctor',
  'Nurse',
  'Phlebotomist',
  'Technician',
  'Dietician',
  'Physio',
  'Biomedical Engineer',
  'Other',
];

export const EXECUTION_DOC_TYPES = ['doctor_form', 'patient_form', 'other', 'gps_selfie'];

export const PAYMENT_SUBMIT_STATUSES = [
  'payment_confirmed',
  'payment_not_checked',
  'payment_hold',
];

/** Guide labels for payment check (stored codes unchanged). */
export const PAYMENT_SUBMIT_STATUS_LABELS = {
  payment_not_checked: 'Pending Confirmation',
  payment_confirmed: 'Confirmed Payment',
  payment_hold: 'Hold',
};

export const FINANCE_PAYMENT_STATUSES = ['not_paid', 'under_review', 'paid'];

export const FINANCE_PAYMENT_STATUS_LABELS = {
  // Finance One internal codes. Camp One Financial selectable status is Payment Done only.
  paid: 'Payment Done',
  not_paid: 'Pending Confirmation',
  under_review: 'Pending Confirmation',
};

export function normalizePaymentSubmitStatus(raw) {
  const v = String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
  const aliases = {
    payment_confirmed: 'payment_confirmed',
    confirmed: 'payment_confirmed',
    validation_completed: 'payment_confirmed',
    payment_not_checked: 'payment_not_checked',
    not_checked: 'payment_not_checked',
    validation_pending: 'payment_not_checked',
    payment_hold: 'payment_hold',
    hold: 'payment_hold',
    payment_on_hold: 'payment_hold',
  };
  return aliases[v] || (PAYMENT_SUBMIT_STATUSES.includes(v) ? v : '');
}

export function normalizeFinancePaymentStatus(raw) {
  const v = String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
  const aliases = {
    paid: 'paid',
    payment_completed: 'paid',
    not_paid: 'not_paid',
    unpaid: 'not_paid',
    under_review: 'under_review',
    review: 'under_review',
  };
  return aliases[v] || (FINANCE_PAYMENT_STATUSES.includes(v) ? v : '');
}

export function formatInTimeIst(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value || '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
  return `${hour}:${minute}`;
}

export function resolveInTimeSelfieUrl(camp = {}) {
  if (camp.inTimeSelfieUrl) return camp.inTimeSelfieUrl;
  const docs = Array.isArray(camp.executionDocuments) ? camp.executionDocuments : [];
  const selfies = docs.filter((d) => d.docType === 'gps_selfie');
  if (!selfies.length) return '';
  const latest = selfies.sort((a, b) =>
    String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''))
  )[0];
  return latest?.url || '';
}

export function resolveCampSlot(startTime) {
  const mins = parseTimeToMinutes(startTime);
  if (mins == null) return '';
  if (mins >= 6 * 60 && mins < 13 * 60) return 'Morning';
  if (mins >= 13 * 60 && mins < 17 * 60) return 'Noon';
  if (mins >= 17 * 60 && mins <= 21 * 60) return 'Evening';
  return '';
}

/** On time / early through 5 min late → Good; 5–15 min late → Average; 15+ min late → Poor. */
export function resolvePunctuality(campStartTime, inTime) {
  const startMins = parseTimeToMinutes(campStartTime);
  const inMins = parseTimeToMinutes(inTime);
  if (startMins == null || inMins == null) return '';

  let lateMinutes = inMins - startMins;
  if (lateMinutes < -12 * 60) lateMinutes += 24 * 60;
  if (lateMinutes > 12 * 60) lateMinutes -= 24 * 60;

  if (lateMinutes <= 5) return 'Good';
  if (lateMinutes <= 15) return 'Average';
  return 'Poor';
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function computeLifecycleDerived(camp = {}, { pricing = null } = {}) {
  const startTime = localTrim(camp.startTime);
  const endTime = localTrim(camp.endTime);
  const inTime = localTrim(camp.inTime);
  const outTime = localTrim(camp.outTime);
  const durationHours = num(camp.durationHours, 0);

  const campSlot = resolveCampSlot(startTime);

  let totalHours = camp.totalHours;
  if (inTime && outTime) {
    totalHours = computeDurationHours(inTime, outTime);
  }

  let extraHours = 0;
  if (totalHours != null && durationHours > 0) {
    extraHours = Math.max(0, Math.round((totalHours - durationHours) * 100) / 100);
  }

  const autoRevenue = pricing
    ? computeCampRevenueFromPricing({ ...camp, totalHours, extraHours }, pricing)
    : null;

  // Editable persisted values win; Client Master formula is only a default/suggestion.
  const campRevenue = num(camp.campRevenue);
  const travelRevenue = num(camp.travelRevenue);
  const overtimeRevenue = num(camp.overtimeRevenue);
  const otherRevenue = num(camp.otherRevenue);
  const otherRevenuePatients = autoRevenue ? autoRevenue.otherRevenuePatients : 0;
  const otherRevenueDistance = autoRevenue ? autoRevenue.otherRevenueDistance : 0;
  const totalRevenue = Math.round((campRevenue + travelRevenue + overtimeRevenue + otherRevenue) * 100) / 100;

  const campAmount = num(camp.campAmount);
  const travelling = num(camp.travelling);
  const overtimeExpense = num(camp.overtimeExpense);
  const otherExpenses = num(camp.otherExpenses);
  const totalPayout = Math.round((campAmount + travelling + overtimeExpense + otherExpenses) * 100) / 100;

  const paidAmount = num(camp.paidAmount);
  const balance = Math.round((totalPayout - paidAmount) * 100) / 100;
  const netContribution = Math.round((totalRevenue - totalPayout) * 100) / 100;

  const kmRoundTrip = num(camp.kmRoundTrip);

  const punctuality = resolvePunctuality(startTime, inTime);

  return {
    campSlot,
    totalHours: totalHours ?? null,
    extraHours,
    campRevenue,
    travelRevenue,
    overtimeRevenue,
    otherRevenue,
    otherRevenuePatients,
    otherRevenueDistance,
    totalRevenue,
    totalPayout,
    netContribution,
    balance,
    kmRoundTrip,
    punctuality,
    revenueAutoCalculated: Boolean(autoRevenue),
    formulaCampRevenue: autoRevenue ? autoRevenue.campRevenue : 0,
    formulaTravelRevenue: autoRevenue ? autoRevenue.travelRevenue : 0,
    formulaOvertimeRevenue: autoRevenue ? autoRevenue.overtimeRevenue : 0,
    formulaOtherRevenue: autoRevenue ? autoRevenue.otherRevenue : 0,
    formulaTotalRevenue: autoRevenue ? autoRevenue.totalRevenue : 0,
  };
}

export function lifecyclePayloadFromBody(body, existing = null, { pricing = null } = {}) {
  const pick = (key, fallback = '') => {
    if (body[key] !== undefined) return body[key];
    return existing?.[key] ?? fallback;
  };

  const pickNum = (key, fallback = 0) => {
    if (body[key] !== undefined && body[key] !== '') {
      return Math.max(0, num(body[key], fallback));
    }
    return existing?.[key] ?? fallback;
  };

  const pickStr = (key, fallback = '') => localTrim(pick(key, fallback));

  const requestedStage = normalizeLifecycleStage(pickStr('lifecycleStage'), '');
  const lifecycleStage = requestedStage
    ? maxLifecycleStage(existing?.lifecycleStage || 'request', requestedStage)
    : normalizeLifecycleStage(existing?.lifecycleStage, 'request');

  const assignmentStatus = ASSIGNMENT_STATUSES.includes(pickStr('assignmentStatus'))
    ? pickStr('assignmentStatus')
    : existing?.assignmentStatus || 'Pending';

  const assignmentDecision = ASSIGNMENT_DECISIONS.includes(pickStr('assignmentDecision'))
    ? pickStr('assignmentDecision')
    : existing?.assignmentDecision || '';

  const assignmentRefusalReason = ASSIGNMENT_REFUSAL_REASONS.includes(pickStr('assignmentRefusalReason'))
    ? pickStr('assignmentRefusalReason')
    : existing?.assignmentRefusalReason || '';

  const hcwContactId = pick('hcwContactId') !== undefined && pick('hcwContactId') !== ''
    ? pick('hcwContactId')
    : existing?.hcwContactId ?? null;

  const requestedExecutionStatus = normalizeExecutionStatus(pickStr('executionStatus'));
  const executionStatus = requestedExecutionStatus === EXECUTION_STATUS.CAMP_COMPLETED
    || isExecutionClosedOut(requestedExecutionStatus)
    ? (EXECUTION_STATUSES.includes(requestedExecutionStatus)
      ? requestedExecutionStatus
      : existing?.executionStatus || EXECUTION_STATUS.CAMP_SCHEDULED)
    : syncExecutionStatusForSave({ ...existing, ...body }, new Date());

  const chargeableStatus = CHARGEABLE_STATUSES.includes(pickStr('chargeableStatus'))
    ? pickStr('chargeableStatus')
    : existing?.chargeableStatus || '';

  const attire = ATTIRE_CHECK_OPTIONS.includes(pickStr('attire'))
    ? pickStr('attire')
    : existing?.attire || '';

  const labCoat = ATTIRE_CHECK_OPTIONS.includes(pickStr('labCoat'))
    ? pickStr('labCoat')
    : existing?.labCoat || '';

  const hcwCategory = HCW_CATEGORIES.includes(pickStr('hcwCategory'))
    ? pickStr('hcwCategory')
    : existing?.hcwCategory || '';

  const requestDateRaw = pick('requestDate');
  const requestDate = requestDateRaw
    ? String(requestDateRaw).slice(0, 10)
    : existing?.requestDate || '';

  const payload = {
    lifecycleStage,
    requestDate,
    hq: pickStr('hq'),
    zone: pickStr('zone'),
    campSlot: resolveCampSlot(pickStr('startTime') || existing?.startTime || ''),
    assignmentStatus,
    assignmentDecision,
    assignmentRefusalReason,
    hcwContactId,
    hcwCategory,
    hcwName: pickStr('hcwName'),
    hcwContact: pickStr('hcwContact'),
    executionStatus,
    cancellationReason: pickStr('cancellationReason', pickStr('remarks')),
    chargeableStatus,
    inTime: pickStr('inTime'),
    inTimeSelfieUrl:
      body.inTimeSelfieUrl !== undefined
        ? pickStr('inTimeSelfieUrl')
        : existing?.inTimeSelfieUrl || resolveInTimeSelfieUrl(existing || {}),
    outTime: pickStr('outTime'),
    kmRoundTrip: pickNum('kmRoundTrip'),
    attire,
    labCoat,
    rxCount: Math.max(0, Math.floor(pickNum('rxCount'))),
    campRevenue: pickNum('campRevenue'),
    travelRevenue: pickNum('travelRevenue'),
    overtimeRevenue: pickNum('overtimeRevenue'),
    otherRevenue: pickNum('otherRevenue'),
    campAmount: pickNum('campAmount'),
    travelling: pickNum('travelling'),
    overtimeExpense: pickNum('overtimeExpense'),
    otherExpenses: pickNum('otherExpenses'),
    paidAmount: pickNum('paidAmount'),
    transactionId: pickStr('transactionId'),
    paymentRemark: pickStr('paymentRemark'),
    paymentSubmitStatus:
      body.paymentSubmitStatus !== undefined
        ? normalizePaymentSubmitStatus(body.paymentSubmitStatus)
        : existing?.paymentSubmitStatus || '',
    // Payment Done (paid) may only be set by Finance One — never via Camp PUT body.
    // Once paid, Camp PUT must not reverse or clear it either.
    financePaymentStatus: (() => {
      const existingStatus = normalizeFinancePaymentStatus(existing?.financePaymentStatus);
      if (existingStatus === 'paid') {
        return existing?.financePaymentStatus || 'paid';
      }
      if (body.financePaymentStatus === undefined) {
        return existing?.financePaymentStatus || '';
      }
      const next = normalizeFinancePaymentStatus(body.financePaymentStatus);
      if (next === 'paid') {
        return existing?.financePaymentStatus || '';
      }
      return next;
    })(),
  };

  if (body.patientsCount !== undefined) {
    payload.actualPatients = Math.max(0, Math.floor(pickNum('patientsCount')));
  } else if (body.actualPatients !== undefined) {
    payload.actualPatients = Math.max(0, Math.floor(pickNum('actualPatients')));
  }

  if (Array.isArray(body.executionDocuments)) {
    payload.executionDocuments = body.executionDocuments;
  } else if (existing?.executionDocuments) {
    payload.executionDocuments = existing.executionDocuments;
  } else {
    payload.executionDocuments = [];
  }

  if (Array.isArray(body.consumablesUsed)) {
    payload.consumablesUsed = normalizeConsumablesUsed(body.consumablesUsed);
  } else if (existing?.consumablesUsed) {
    payload.consumablesUsed = existing.consumablesUsed;
  } else {
    payload.consumablesUsed = [];
  }

  const derived = computeLifecycleDerived({ ...existing, ...body, ...payload }, { pricing });
  const next = { ...payload, ...derived };
  // Never let formula-derived fields overwrite explicit revenue edits from the client.
  next.campRevenue = payload.campRevenue;
  next.travelRevenue = payload.travelRevenue;
  next.overtimeRevenue = payload.overtimeRevenue;
  next.otherRevenue = payload.otherRevenue;

  const bodyTouchedRevenue = ['campRevenue', 'travelRevenue', 'overtimeRevenue', 'otherRevenue']
    .some((key) => body[key] !== undefined && body[key] !== '');
  const revenueEmpty = [next.campRevenue, next.travelRevenue, next.overtimeRevenue, next.otherRevenue]
    .every((value) => num(value) === 0);
  if (pricing && derived.revenueAutoCalculated && !bodyTouchedRevenue && revenueEmpty) {
    next.campRevenue = derived.formulaCampRevenue;
    next.travelRevenue = derived.formulaTravelRevenue;
    next.overtimeRevenue = derived.formulaOvertimeRevenue;
    next.otherRevenue = derived.formulaOtherRevenue;
  }

  if (body.totalRevenue !== undefined && body.totalRevenue !== '') {
    next.totalRevenue = Math.max(0, num(body.totalRevenue));
  } else {
    next.totalRevenue = Math.round((
      num(next.campRevenue) + num(next.travelRevenue) + num(next.overtimeRevenue) + num(next.otherRevenue)
    ) * 100) / 100;
  }
  if (body.totalPayout !== undefined && body.totalPayout !== '') {
    next.totalPayout = Math.max(0, num(body.totalPayout));
  }
  next.netContribution = Math.round((num(next.totalRevenue) - num(next.totalPayout)) * 100) / 100;
  // Don't persist transient breakdown / flag fields on the camp document.
  delete next.otherRevenuePatients;
  delete next.otherRevenueDistance;
  delete next.revenueAutoCalculated;
  delete next.formulaCampRevenue;
  delete next.formulaTravelRevenue;
  delete next.formulaOvertimeRevenue;
  delete next.formulaOtherRevenue;
  delete next.formulaTotalRevenue;
  return next;
}

export function withCampLifecycle(camp) {
  const obj = camp?.toObject ? camp.toObject() : { ...camp };
  obj.lifecycleStage = normalizeLifecycleStage(obj.lifecycleStage, 'request');
  const derived = computeLifecycleDerived(obj);
  Object.assign(obj, derived);
  delete obj.otherRevenuePatients;
  delete obj.otherRevenueDistance;
  delete obj.revenueAutoCalculated;
  delete obj.formulaCampRevenue;
  delete obj.formulaTravelRevenue;
  delete obj.formulaOvertimeRevenue;
  delete obj.formulaOtherRevenue;
  delete obj.formulaTotalRevenue;
  obj.patientsCount = obj.actualPatients ?? 0;
  obj.lifecycleStages = CAMP_LIFECYCLE_STAGES;
  obj.effectiveExecutionStatus = resolveEffectiveExecutionStatus(obj);
  return obj;
}

export function applyAssignmentStageOutcome(camp, body = {}, now = new Date()) {
  // Prefer editingStage — clients may send a target lifecycleStage for advancement.
  const stage = normalizeLifecycleStage(
    body.editingStage || body.lifecycleStage || camp.lifecycleStage,
    'request',
  );
  if (stage !== 'assignment') return;

  const decision = ASSIGNMENT_DECISIONS.includes(localTrim(body.assignmentDecision))
    ? localTrim(body.assignmentDecision)
    : camp.assignmentDecision;
  if (!decision) return;

  if (decision === 'assign') {
    const hcwCategory = localTrim(body.hcwCategory ?? camp.hcwCategory);
    const hcwName = localTrim(body.hcwName ?? camp.hcwName);
    const hcwContact = localTrim(body.hcwContact ?? camp.hcwContact);
    if (!hcwCategory || !hcwName || !hcwContact) {
      throw new Error('HCW Category, Name, and Contact are required when assigning');
    }
    const previousStage = normalizeLifecycleStage(camp.lifecycleStage, 'request');
    camp.assignmentDecision = 'assign';
    camp.assignmentStatus = 'Assigned';
    camp.assignmentRefusalReason = '';
    // Reassignment must not demote camps already in Execution / Finance.
    if (previousStage === 'execution' || previousStage === 'financial') {
      camp.lifecycleStage = previousStage;
    } else {
      // Guide: Assigned → Execution / Planned immediately (no D-1 wait).
      camp.lifecycleStage = 'execution';
      camp.executionStatus = EXECUTION_STATUS.CAMP_SCHEDULED;
    }
    if (
      normalizeLifecycleStage(camp.lifecycleStage, 'request') === 'execution'
      && getMarkExecutedFieldBlockers(camp).length === 0
      && !isExecutionCancellationForFinance(camp)
    ) {
      const current = normalizeExecutionStatus(camp.executionStatus);
      if (
        current !== EXECUTION_STATUS.MARKED_EXECUTED
        && current !== EXECUTION_STATUS.CAMP_COMPLETED
      ) {
        camp.executionStatus = EXECUTION_STATUS.MARKED_EXECUTED;
      }
    }
    void now;
    return;
  }

  const reason = ASSIGNMENT_REFUSAL_REASONS.includes(localTrim(body.assignmentRefusalReason))
    ? localTrim(body.assignmentRefusalReason)
    : (localTrim(body.assignmentRefusalReason) === 'Rejected' ? 'Refused' : camp.assignmentRefusalReason);
  if (!reason) {
    throw new Error('Select a refusal reason');
  }

  camp.assignmentRefusalReason = reason;
  camp.cancellationReason = reason;
  clearCampHcwAssignment(camp);

  if (reason === 'Refused' || reason === 'Rejected') {
    camp.status = 'rejected';
    camp.lifecycleStage = 'request';
    camp.requestReviewStatus = 'request_rejected';
    camp.assignmentStatus = 'Unassigned';
  } else {
    // Cancellation from Assignment is no longer a valid workflow path.
    throw new Error('Cancellation is only permitted during Execution; use Refuse during Assignment');
  }
}

export function isAssignedForExecutionAdvance(camp = {}) {
  if (['cancelled', 'rejected'].includes(localTrim(camp?.status))) return false;
  if (localTrim(camp?.assignmentDecision) !== 'assign') return false;
  if (localTrim(camp?.assignmentStatus) === 'Assigned') return true;
  return Boolean(localTrim(camp?.hcwContactId) || localTrim(camp?.hcwName));
}

/** Move an assigned camp from Assignment → Execution immediately. */
export function promoteAssignedCampToExecutionIfDue(camp, now = new Date()) {
  if (!camp) return false;
  const stage = normalizeLifecycleStage(camp.lifecycleStage, 'request');
  if (stage !== 'assignment') return false;
  if (!isAssignedForExecutionAdvance(camp)) return false;

  camp.lifecycleStage = 'execution';
  if (!localTrim(camp.executionStatus) || normalizeExecutionStatus(camp.executionStatus) === EXECUTION_STATUS.CAMP_ONGOING) {
    camp.executionStatus = EXECUTION_STATUS.CAMP_SCHEDULED;
  }
  if (getMarkExecutedFieldBlockers(camp).length === 0) {
    camp.executionStatus = EXECUTION_STATUS.MARKED_EXECUTED;
  }
  void now;
  return true;
}

/**
 * Persist Assignment → Execution promotions for assigned camps that are still on Assignment
 * (legacy D-1 backlog). Called on camp list/detail reads.
 */
export async function promoteDueAssignedCampsToExecution(CampModel = null, now = new Date()) {
  const Camp = CampModel || (await import('./campOps.model.js')).CampOpsCamp;

  const candidates = await Camp.find({
    isDeleted: false,
    status: { $nin: ['cancelled', 'rejected'] },
    lifecycleStage: 'assignment',
    assignmentDecision: 'assign',
    $or: [
      { assignmentStatus: 'Assigned' },
      { hcwContactId: { $exists: true, $nin: [null, ''] } },
      { hcwName: { $exists: true, $nin: [null, ''] } },
    ],
  });

  let promoted = 0;
  for (const camp of candidates) {
    if (!promoteAssignedCampToExecutionIfDue(camp, now)) continue;
    await camp.save();
    promoted += 1;
  }
  return promoted;
}

export function canEditLifecycleStage(camp, stage, { isAdmin = false } = {}) {
  const status = localTrim(camp?.status);
  const reached = normalizeLifecycleStage(camp?.lifecycleStage, 'request');
  const target = normalizeLifecycleStage(stage, '');
  if (!target) return false;

  const paymentDone = normalizeFinancePaymentStatus(camp?.financePaymentStatus) === 'paid';
  if (paymentDone && !isAdmin) {
    return false;
  }

  if (status === 'cancelled') {
    if (target !== 'financial') return false;
    if (!isExecutionCancellationForFinance(camp)) return false;
    return reached === 'financial' || hasReachedLifecycleStage(reached, 'execution');
  }

  // Financial stage is only editable once the camp has entered Financial.
  if (target === 'financial') {
    if (reached !== 'financial') return false;
    return ['executed', 'approved', 'cancelled'].includes(status);
  }

  // After Mark Complete / Financial entry, lock earlier stages for normal users.
  if (reached === 'financial' && !isAdmin) {
    if (target === 'execution' || target === 'assignment') return false;
    if (target === 'request') return ['pending_review', 'rejected'].includes(status);
  }

  const stageReachable = hasReachedLifecycleStage(reached, target);
  if (!stageReachable) return false;
  if (target === 'request') {
    return ['pending_review', 'approved', 'rejected', 'executed'].includes(status);
  }
  if (target === 'assignment') {
    if (['cancelled', 'rejected'].includes(status)) return false;
    return ['approved', 'executed'].includes(status);
  }
  if (target === 'execution') {
    return ['approved', 'executed'].includes(status);
  }
  return false;
}

/** Normalize title-cased lifecycle stages and move executed camps into Finance & Settlement. */
export async function repairExecutedCampLifecycleStages(CampModel = null) {
  const Camp = CampModel || (await import('./campOps.model.js')).CampOpsCamp;
  const rows = await Camp.find({ isDeleted: false });
  let repaired = 0;
  for (const camp of rows) {
    let changed = false;
    const normalized = normalizeLifecycleStage(camp.lifecycleStage, 'request');
    if (camp.lifecycleStage !== normalized) {
      camp.lifecycleStage = normalized;
      changed = true;
    }
    if (
      camp.status === 'rejected'
      && ['assignment', 'execution', 'financial'].includes(normalized)
    ) {
      camp.lifecycleStage = 'request';
      camp.requestReviewStatus = 'request_rejected';
      changed = true;
    }
    if (
      camp.status === 'executed'
      && ['request', 'assignment', 'execution'].includes(normalized)
    ) {
      camp.lifecycleStage = 'financial';
      if (camp.executionStatus !== 'Camp Completed') {
        camp.executionStatus = 'Camp Completed';
      }
      changed = true;
    }
    if (
      camp.status === 'cancelled'
      && isExecutionCancellationForFinance(camp)
      && ['request', 'assignment', 'execution'].includes(normalized)
    ) {
      const closureStatus = resolveCancelledClosureExecutionStatus(camp);
      if (closureStatus && camp.executionStatus !== closureStatus) {
        camp.executionStatus = closureStatus;
        changed = true;
      }
      camp.lifecycleStage = 'financial';
      changed = true;
    }
    if (changed) {
      await camp.save();
      repaired += 1;
    }
  }
  return repaired;
}

/** Move legacy cancelled closure camps stuck before Financial into Finance & Settlement. */
export async function repairCancelledClosureCampsToFinancial(CampModel = null) {
  const Camp = CampModel || (await import('./campOps.model.js')).CampOpsCamp;
  const rows = await Camp.find({
    isDeleted: false,
    status: 'cancelled',
    lifecycleStage: { $nin: ['financial', 'Financial'] },
  });
  let repaired = 0;
  for (const camp of rows) {
    if (!isExecutionCancellationForFinance(camp)) continue;
    let changed = false;
    const closureStatus = resolveCancelledClosureExecutionStatus(camp);
    if (closureStatus && camp.executionStatus !== closureStatus) {
      camp.executionStatus = closureStatus;
      changed = true;
    }
    const normalized = normalizeLifecycleStage(camp.lifecycleStage, 'request');
    if (camp.lifecycleStage !== normalized) {
      camp.lifecycleStage = normalized;
      changed = true;
    }
    if (normalized !== 'financial') {
      camp.lifecycleStage = 'financial';
      changed = true;
    }
    if (changed) {
      await camp.save();
      repaired += 1;
    }
  }
  return repaired;
}
