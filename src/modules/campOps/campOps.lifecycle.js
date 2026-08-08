import { normalizeConsumablesUsed, getConsumablesCompletionBlockers } from './campConsumables.js';
import {
  parseTimeToMinutes,
  computeDurationHours,
  getCampStartDateTime,
  getCampEndDateTime,
} from './campOps.helpers.js';
import { daysFromToday, localTodayIso } from './campDatePolicy.js';

function localTrim(v) {
  return v == null ? '' : String(v).trim();
}

/** Assigned camps enter Execution starting one calendar day before camp date. */
export const EXECUTION_ADVANCE_DAYS_BEFORE = 1;

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

const LEGACY_EXECUTION_STATUS_ALIASES = {
  Pending: EXECUTION_STATUS.CAMP_SCHEDULED,
  'Yet to Start': EXECUTION_STATUS.CAMP_SCHEDULED,
  'In Progress': EXECUTION_STATUS.CAMP_ONGOING,
  Ongoing: EXECUTION_STATUS.CAMP_ONGOING,
  Executed: EXECUTION_STATUS.MARKED_EXECUTED,
  Completed: EXECUTION_STATUS.CAMP_COMPLETED,
};

export function normalizeExecutionStatus(executionStatus) {
  const value = String(executionStatus || '').trim();
  if (value === 'Rejected') return 'Refused';
  if (LEGACY_EXECUTION_STATUS_ALIASES[value]) return LEGACY_EXECUTION_STATUS_ALIASES[value];
  return value;
}

export function isExecutionClosedOut(executionStatus) {
  return LEGACY_EXECUTION_CLOSED_STATUSES.includes(normalizeExecutionStatus(executionStatus));
}

export function resolveScheduledExecutionStatus(camp = {}, now = new Date()) {
  const start = getCampStartDateTime(camp);
  const end = getCampEndDateTime(camp);
  if (!start || !end) return EXECUTION_STATUS.CAMP_SCHEDULED;

  const ts = now.getTime();
  if (ts < start.getTime()) return EXECUTION_STATUS.CAMP_SCHEDULED;
  if (ts <= end.getTime()) return EXECUTION_STATUS.CAMP_ONGOING;
  return EXECUTION_STATUS.MARKED_EXECUTED;
}

export function resolveEffectiveExecutionStatus(camp = {}, now = new Date()) {
  const normalized = normalizeExecutionStatus(camp.executionStatus);
  if (normalized === EXECUTION_STATUS.CAMP_COMPLETED) return EXECUTION_STATUS.CAMP_COMPLETED;
  if (isExecutionClosedOut(normalized)) return normalized;
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

export const MARK_EXECUTED_MINUTES_AFTER_START = 30;

export function getMarkExecutedFieldBlockers(camp = {}) {
  const blockers = [];
  if (!localTrim(camp.chargeableStatus)) blockers.push('Select Chargeable Status');
  if (!localTrim(camp.inTime)) blockers.push('Enter In Time');
  if (!localTrim(camp.attire)) blockers.push('Select Attire');
  return blockers;
}

export function isMarkExecutedTimingOpen(camp = {}, now = new Date()) {
  const start = getCampStartDateTime(camp);
  if (!start) return false;
  const earliest = start.getTime() + MARK_EXECUTED_MINUTES_AFTER_START * 60 * 1000;
  return now.getTime() >= earliest;
}

export function getMarkExecutedTimingBlockers(camp = {}, now = new Date()) {
  if (isMarkExecutedTimingOpen(camp, now)) return [];
  return [
    `Camp can be marked executed only after ${MARK_EXECUTED_MINUTES_AFTER_START} minutes from start time`,
  ];
}

export function assertCanMarkCampExecuted(camp = {}, now = new Date()) {
  if (camp.assignmentDecision !== 'assign' || !camp.hcwContactId) {
    throw new Error('Assign a healthcare worker before marking the camp executed');
  }
  const fieldBlockers = getMarkExecutedFieldBlockers(camp);
  if (fieldBlockers.length) {
    throw new Error(fieldBlockers[0]);
  }
  const timingBlockers = getMarkExecutedTimingBlockers(camp, now);
  if (timingBlockers.length) {
    throw new Error(timingBlockers[0]);
  }
}

export function getExecutionFinanceBlockers(camp = {}, mappedConsumables = []) {
  const blockers = [];
  if (isExecutionClosedOut(camp.executionStatus)) {
    blockers.push('Execution is cancelled or refused');
    return blockers;
  }
  if (normalizeExecutionStatus(camp.executionStatus) !== EXECUTION_STATUS.CAMP_COMPLETED) {
    blockers.push('Set execution status to Camp Completed');
  }
  if (!localTrim(camp.chargeableStatus)) {
    blockers.push('Select chargeable status');
  }
  if (!localTrim(camp.inTime)) {
    blockers.push('Enter in time on the execution form');
  }
  if (!localTrim(camp.outTime)) {
    blockers.push('Enter out time on the execution form');
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

export const HCW_CATEGORIES = ['Technician', 'Phlebotomist', 'Dietician', 'Other'];

export const EXECUTION_DOC_TYPES = ['doctor_form', 'patient_form', 'other', 'gps_selfie'];

export const PAYMENT_SUBMIT_STATUSES = [
  'payment_confirmed',
  'payment_not_checked',
  'payment_hold',
];

export const FINANCE_PAYMENT_STATUSES = ['not_paid', 'under_review', 'paid'];

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

export function computeLifecycleDerived(camp = {}) {
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

  const campRevenue = num(camp.campRevenue);
  const overtimeRevenue = num(camp.overtimeRevenue);
  const otherRevenue = num(camp.otherRevenue);
  const totalRevenue = Math.round((campRevenue + overtimeRevenue + otherRevenue) * 100) / 100;

  const campAmount = num(camp.campAmount);
  const travelling = num(camp.travelling);
  const overtimeExpense = num(camp.overtimeExpense);
  const otherExpenses = num(camp.otherExpenses);
  const totalPayout = Math.round((campAmount + travelling + overtimeExpense + otherExpenses) * 100) / 100;

  const paidAmount = num(camp.paidAmount);
  const balance = Math.round((totalPayout - paidAmount) * 100) / 100;

  const kmRoundTrip = num(camp.kmRoundTrip);

  const punctuality = resolvePunctuality(startTime, inTime);

  return {
    campSlot,
    totalHours: totalHours ?? null,
    extraHours,
    totalRevenue,
    totalPayout,
    balance,
    kmRoundTrip,
    punctuality,
  };
}

export function lifecyclePayloadFromBody(body, existing = null) {
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
    financePaymentStatus:
      body.financePaymentStatus !== undefined
        ? normalizeFinancePaymentStatus(body.financePaymentStatus)
        : existing?.financePaymentStatus || '',
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

  const derived = computeLifecycleDerived({ ...existing, ...body, ...payload });
  return { ...payload, ...derived };
}

export function withCampLifecycle(camp) {
  const obj = camp?.toObject ? camp.toObject() : { ...camp };
  obj.lifecycleStage = normalizeLifecycleStage(obj.lifecycleStage, 'request');
  const derived = computeLifecycleDerived(obj);
  Object.assign(obj, derived);
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
    camp.assignmentDecision = 'assign';
    camp.assignmentStatus = 'Assigned';
    camp.assignmentRefusalReason = '';
    camp.lifecycleStage = 'assignment';
    camp.executionStatus = syncExecutionStatusForSave(camp, now);
    promoteAssignedCampToExecutionIfDue(camp, now);
    return;
  }

  const reason = ASSIGNMENT_REFUSAL_REASONS.includes(localTrim(body.assignmentRefusalReason))
    ? localTrim(body.assignmentRefusalReason)
    : (localTrim(body.assignmentRefusalReason) === 'Rejected' ? 'Refused' : camp.assignmentRefusalReason);
  if (!reason) {
    throw new Error('Select a refusal reason');
  }

  camp.assignmentDecision = 'refuse';
  camp.assignmentStatus = 'Unassigned';
  camp.assignmentRefusalReason = reason;
  camp.cancellationReason = reason;
  camp.hcwContactId = null;
  camp.hcwCategory = '';
  camp.hcwName = '';
  camp.hcwContact = '';

  if (reason === 'Refused' || reason === 'Rejected') {
    camp.status = 'rejected';
  } else {
    camp.status = 'cancelled';
    camp.cancelledBy = reason === 'Cancelled by Client' ? 'brand' : 'khw';
    camp.remarks = reason;
  }
}

/**
 * True when camp date is tomorrow or earlier (D-1 window for Execution).
 * Missing camp dates are treated as not ready.
 */
export function isCampDateDueForExecution(camp = {}, now = new Date()) {
  const campDate = localTrim(camp?.campDate);
  if (!campDate) return false;
  return daysFromToday(campDate, now) <= EXECUTION_ADVANCE_DAYS_BEFORE;
}

export function isAssignedForExecutionAdvance(camp = {}) {
  if (['cancelled', 'rejected'].includes(localTrim(camp?.status))) return false;
  if (localTrim(camp?.assignmentDecision) !== 'assign') return false;
  if (localTrim(camp?.assignmentStatus) === 'Assigned') return true;
  return Boolean(localTrim(camp?.hcwContactId) || localTrim(camp?.hcwName));
}

/** Move an assigned camp from Assignment → Execution when within D-1 of camp date. */
export function promoteAssignedCampToExecutionIfDue(camp, now = new Date()) {
  if (!camp) return false;
  const stage = normalizeLifecycleStage(camp.lifecycleStage, 'request');
  if (stage !== 'assignment') return false;
  if (!isAssignedForExecutionAdvance(camp)) return false;
  if (!isCampDateDueForExecution(camp, now)) return false;

  camp.lifecycleStage = 'execution';
  camp.executionStatus = syncExecutionStatusForSave(camp, now);
  return true;
}

/**
 * Persist Assignment → Execution promotions for camps whose date is within D-1.
 * Called on camp list/detail reads so stages advance without a separate cron.
 */
export async function promoteDueAssignedCampsToExecution(CampModel = null, now = new Date()) {
  const Camp = CampModel || (await import('./campOps.model.js')).CampOpsCamp;
  const maxCampDate = (() => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + EXECUTION_ADVANCE_DAYS_BEFORE);
    return localTodayIso(date);
  })();

  const candidates = await Camp.find({
    isDeleted: false,
    status: { $nin: ['cancelled', 'rejected'] },
    lifecycleStage: 'assignment',
    assignmentDecision: 'assign',
    campDate: { $lte: maxCampDate, $ne: '' },
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

export function canEditLifecycleStage(camp, stage) {
  const status = localTrim(camp?.status);
  if (status === 'cancelled') return false;
  const reached = normalizeLifecycleStage(camp?.lifecycleStage, 'request');
  const target = normalizeLifecycleStage(stage, '');
  if (!target) return false;
  const stageReachable = target === 'financial'
    ? hasReachedLifecycleStage(reached, 'execution')
    : hasReachedLifecycleStage(reached, target);
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
  if (target === 'financial') {
    if (!hasReachedLifecycleStage(reached, 'execution')) return false;
    return ['executed', 'approved'].includes(status);
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
      camp.status === 'executed'
      && ['request', 'assignment', 'execution'].includes(normalized)
    ) {
      camp.lifecycleStage = 'financial';
      if (camp.executionStatus !== 'Camp Completed') {
        camp.executionStatus = 'Camp Completed';
      }
      changed = true;
    }
    if (changed) {
      await camp.save();
      repaired += 1;
    }
  }
  return repaired;
}
