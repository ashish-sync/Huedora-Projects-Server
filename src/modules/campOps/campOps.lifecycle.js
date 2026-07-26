import { trimStr, parseTimeToMinutes, computeDurationHours } from './campOps.helpers.js';

function localTrim(v) {
  return v == null ? '' : String(v).trim();
}

export const CAMP_LIFECYCLE_STAGES = [
  { id: 'request', label: 'Request Stage', short: 'Request' },
  { id: 'assignment', label: 'Resource Assignment', short: 'Assignment' },
  { id: 'execution', label: 'Camp Execution', short: 'Execution' },
  { id: 'financial', label: 'Finance & Settlement', short: 'Financial' },
];

export function lifecycleStageIndex(stage) {
  return CAMP_LIFECYCLE_STAGES.findIndex((s) => s.id === stage);
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
  if (ai < 0) return b || 'request';
  if (bi < 0) return a || 'request';
  return ai >= bi ? a : b;
}

export const CAMP_SLOTS = ['Morning', 'Noon', 'Evening'];

export const ASSIGNMENT_DECISIONS = ['assign', 'refuse'];

export const ASSIGNMENT_REFUSAL_REASONS = [
  'Refused',
  'Cancelled by TCPL',
  'Cancelled by Client',
];

export const ASSIGNMENT_STATUSES = ['Pending', 'Assigned', 'Reassigned', 'Unassigned'];

export const EXECUTION_STATUSES = ['Pending', 'In Progress', 'Completed', 'Cancelled', 'Rejected'];
export const EXECUTION_CLOSED_STATUSES = ['Cancelled', 'Rejected'];

export function isExecutionClosedOut(executionStatus) {
  return EXECUTION_CLOSED_STATUSES.includes(String(executionStatus || '').trim());
}

export function assertExecutionStageSave(camp = {}) {
  if (!isExecutionClosedOut(camp.executionStatus)) return;
  if (!localTrim(camp.cancellationReason)) {
    throw new Error(
      'Cancellation / Rejection Reason is required when execution status is Cancelled or Rejected',
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
    payment_not_checked: 'payment_not_checked',
    not_checked: 'payment_not_checked',
    payment_hold: 'payment_hold',
    hold: 'payment_hold',
  };
  return aliases[v] || (PAYMENT_SUBMIT_STATUSES.includes(v) ? v : '');
}

export function normalizeFinancePaymentStatus(raw) {
  const v = String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
  const aliases = {
    paid: 'paid',
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

  const allowedStage = CAMP_LIFECYCLE_STAGES.find((s) => s.id === pickStr('lifecycleStage'));
  const requestedStage = allowedStage ? allowedStage.id : '';
  const lifecycleStage = requestedStage
    ? maxLifecycleStage(existing?.lifecycleStage || 'request', requestedStage)
    : existing?.lifecycleStage || 'request';

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

  const executionStatus = EXECUTION_STATUSES.includes(pickStr('executionStatus'))
    ? pickStr('executionStatus')
    : existing?.executionStatus || 'Pending';

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

  const derived = computeLifecycleDerived({ ...existing, ...body, ...payload });
  return { ...payload, ...derived };
}

export function withCampLifecycle(camp) {
  const obj = camp?.toObject ? camp.toObject() : { ...camp };
  const derived = computeLifecycleDerived(obj);
  Object.assign(obj, derived);
  obj.patientsCount = obj.actualPatients ?? 0;
  obj.lifecycleStages = CAMP_LIFECYCLE_STAGES;
  return obj;
}

export function applyAssignmentStageOutcome(camp, body = {}) {
  const stage = localTrim(body.lifecycleStage) || camp.lifecycleStage || 'request';
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
    camp.lifecycleStage = 'execution';
    camp.executionStatus = camp.executionStatus === 'Pending' ? 'Pending' : camp.executionStatus;
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

export function canEditLifecycleStage(camp, stage) {
  const status = camp?.status;
  if (status === 'cancelled') return false;
  const reached = camp?.lifecycleStage || 'request';
  const stageReachable = stage === 'financial'
    ? hasReachedLifecycleStage(reached, 'execution')
    : hasReachedLifecycleStage(reached, stage);
  if (!stageReachable) return false;
  if (stage === 'request') {
    return ['pending_review', 'approved', 'rejected', 'executed'].includes(status);
  }
  if (stage === 'assignment') {
    if (['cancelled', 'rejected'].includes(status)) return false;
    return ['approved', 'executed'].includes(status);
  }
  if (stage === 'execution') {
    return ['approved', 'executed'].includes(status);
  }
  if (stage === 'financial') {
    if (!hasReachedLifecycleStage(reached, 'execution')) return false;
    return ['executed', 'approved'].includes(status);
  }
  return false;
}
