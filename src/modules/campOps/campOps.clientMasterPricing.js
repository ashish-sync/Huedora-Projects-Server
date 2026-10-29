/**
 * Client Master pricing units → Camp One / Financial stage revenue auto-calc.
 *
 * Financial Stage camp units (Client Master):
 *   Executed Chargeable → executedCampUnit
 *   Cancelled Chargeable → cancelledCampUnit
 *   Cancelled Non-Chargeable → always 0 financial units (all revenue parts)
 *
 * Overtime Revenue (executed / chargeable paths only):
 *   max(0, Total Hours − Camp Duration) × OT Unit
 *   Total Hours = In→Out; Camp Duration = Client Master campDuration (fallback: camp durationHours)
 *
 * Other Revenue (excess over minimums):
 *   max(0, patientsScreened − minPatients) × extPatientUnit
 *   + max(0, kmRoundTrip − minKms) × kmsUnit
 */

import { CampOpsClientMaster } from './campOps.model.js';
import { normalizeCampName } from './campOps.constants.js';

function trimStr(value) {
  return String(value ?? '').trim();
}

function normalizeDivisionKey(value) {
  return trimStr(value)
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ');
}

function normalizeMethodKey(value) {
  return normalizeDivisionKey(normalizeCampName(value) || value);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value) {
  return Math.round(num(value) * 100) / 100;
}

/** Parse Client Master Camp Duration (`4:00`, `4:30`, `3 Hours`) to decimal hours. */
export function parseCampDurationToHours(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const clock = raw.match(/^(\d{1,2}):([0-5]\d)$/);
  if (clock) {
    return Math.round((Number(clock[1]) + Number(clock[2]) / 60) * 100) / 100;
  }
  const hoursOnly = raw.match(/^(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)?$/i);
  if (hoursOnly) return num(hoursOnly[1]);
  const n = num(raw, NaN);
  return Number.isFinite(n) ? n : 0;
}

/**
 * OT Hours = Total Hours − Client Master Camp Duration.
 * Falls back to the camp's scheduled durationHours only when Client Master duration is missing.
 */
export function computeOvertimeHours(totalHours, { campDuration = '', durationHours = 0 } = {}) {
  const billedHours = parseCampDurationToHours(campDuration) || num(durationHours, 0);
  const hours = num(totalHours, NaN);
  if (!Number.isFinite(hours) || billedHours <= 0) return 0;
  return Math.max(0, Math.round((hours - billedHours) * 100) / 100);
}

/**
 * True when overtime $ still matches the old Extra hours formula
 * (Total Hours − scheduled durationHours) × OT Unit. Those rows were stored
 * before Client Master camp duration drove Extra hours.
 */
export function looksLikeStaleScheduledOvertime(camp = {}, pricing = null) {
  const otUnit = num(pricing?.otUnit);
  if (!(otUnit > 0)) return false;
  const stored = num(camp.overtimeRevenue);
  if (!(stored > 0)) return false;
  const hours = num(camp.totalHours, NaN);
  if (!Number.isFinite(hours)) return false;
  const staleHours = computeOvertimeHours(hours, { durationHours: camp.durationHours });
  const billedHours = computeOvertimeHours(hours, {
    campDuration: pricing.campDuration || camp.clientMasterCampDuration,
    durationHours: camp.durationHours,
  });
  if (!(staleHours > 0) || staleHours === billedHours) return false;
  return stored === roundMoney(staleHours * otUnit);
}

function normalizeExecutionStatus(executionStatus) {
  const value = trimStr(executionStatus);
  if (value === 'Rejected') return 'Refused';
  return value;
}

export function extractClientMasterPricingUnits(record = {}) {
  if (!record) return null;
  return {
    executedCampUnit: num(record.executedCampUnit),
    cancelledCampUnit: num(record.cancelledCampUnit),
    otUnit: num(record.otUnit),
    minimumPatientCovered: num(record.minimumPatientCovered),
    minimumKmsCovered: num(record.minimumKmsCovered),
    extPatientUnit: num(record.extPatientUnit),
    kmsUnit: num(record.kmsUnit),
    campDuration: trimStr(record.campDuration),
    clientMasterId: record._id ? String(record._id) : '',
    programName: trimStr(record.programName || record.drugTherapyName),
    campName: trimStr(record.campName),
  };
}

/** Pick the best Client Master row for a camp (exact division+method, else division). */
export function resolveClientMasterPricingFromRecords(
  records = [],
  { campaignType = '', campaignName = '' } = {},
) {
  const divisionKey = normalizeDivisionKey(campaignType);
  const methodKey = normalizeMethodKey(campaignName);
  const activeRecords = (records || []).filter((record) => record?.isActive !== false && !record?.isDeleted);

  if (divisionKey && methodKey) {
    const exact = activeRecords.find((record) => (
      normalizeDivisionKey(record.programName || record.drugTherapyName) === divisionKey
      && normalizeMethodKey(record.campName) === methodKey
    ));
    if (exact) return extractClientMasterPricingUnits(exact);
  }

  if (divisionKey) {
    const byDivision = activeRecords.find((record) => (
      normalizeDivisionKey(record.programName || record.drugTherapyName) === divisionKey
    ));
    if (byDivision) return extractClientMasterPricingUnits(byDivision);
  }

  if (activeRecords.length === 1) {
    return extractClientMasterPricingUnits(activeRecords[0]);
  }

  return null;
}

export async function resolveClientMasterPricingForCamp(clientId, {
  campaignType = '',
  campaignName = '',
  clientName = '',
} = {}) {
  if (!clientId && !clientName) return null;
  let records = clientId
    ? await CampOpsClientMaster.find({
      isDeleted: false,
      clientId: String(clientId),
    }).sort('programName')
    : [];

  if (!records.length && clientName) {
    const all = await CampOpsClientMaster.find({ isDeleted: false }).sort('programName');
    const needle = trimStr(clientName).toLowerCase();
    records = all.filter((row) => trimStr(row.clientName).toLowerCase() === needle);
  }

  return resolveClientMasterPricingFromRecords(records, { campaignType, campaignName });
}

export function isCampExecutedForRevenue(camp = {}) {
  const status = trimStr(camp.status).toLowerCase();
  if (status === 'executed') return true;
  const exec = normalizeExecutionStatus(camp.executionStatus);
  return exec === 'Camp Completed' || exec === 'Marked Executed';
}

const CANCELLED_EXECUTION_STATUSES = new Set([
  'Cancelled',
  'Refused',
  'Cancelled by Tylo',
  'Cancelled by Client',
]);

export function isCampCancelledForRevenue(camp = {}) {
  const status = trimStr(camp.status).toLowerCase();
  if (status === 'cancelled') return true;
  const exec = normalizeExecutionStatus(camp.executionStatus);
  if (CANCELLED_EXECUTION_STATUSES.has(exec)) return true;
  const reason = normalizeExecutionStatus(camp.assignmentRefusalReason);
  if (CANCELLED_EXECUTION_STATUSES.has(reason)) return true;
  if (camp.cancelledBy === 'brand' || camp.cancelledBy === 'khw') return true;
  return false;
}

export function isCampChargeable(camp = {}) {
  const value = trimStr(camp.chargeableStatus);
  if (!value) return false;
  if (/^non[-\s]?chargeable$/i.test(value)) return false;
  return true; // Chargeable or Partial
}

/**
 * @returns {{
 *   campRevenue: number,
 *   travelRevenue: number,
 *   overtimeRevenue: number,
 *   otherRevenuePatients: number,
 *   otherRevenueDistance: number,
 *   otherRevenue: number,
 *   totalRevenue: number,
 * }}
 */
export function computeCampRevenueFromPricing(camp = {}, pricing = null) {
  const empty = {
    campRevenue: 0,
    travelRevenue: 0,
    overtimeRevenue: 0,
    otherRevenuePatients: 0,
    otherRevenueDistance: 0,
    otherRevenue: 0,
    totalRevenue: 0,
  };
  if (!pricing) return empty;

  const cancelled = isCampCancelledForRevenue(camp);
  const chargeable = isCampChargeable(camp);

  // Cancelled Non-Chargeable → always 0 financial units.
  if (cancelled && !chargeable) {
    return empty;
  }

  let campRevenue = 0;
  if (!chargeable) {
    campRevenue = 0;
  } else if (cancelled) {
    campRevenue = num(pricing.cancelledCampUnit);
  } else if (isCampExecutedForRevenue(camp)) {
    campRevenue = num(pricing.executedCampUnit);
  }

  const overtimeHours = computeOvertimeHours(camp.totalHours, {
    campDuration: pricing.campDuration || camp.clientMasterCampDuration,
    durationHours: camp.durationHours,
  });
  const overtimeRevenue = roundMoney(overtimeHours * num(pricing.otUnit));

  const patientsScreened = num(
    camp.actualPatients != null && camp.actualPatients !== ''
      ? camp.actualPatients
      : camp.patientsCount,
  );
  const kmRoundTrip = num(camp.kmRoundTrip);
  const otherRevenuePatients = roundMoney(
    Math.max(0, patientsScreened - num(pricing.minimumPatientCovered)) * num(pricing.extPatientUnit),
  );
  const otherRevenueDistance = roundMoney(
    Math.max(0, kmRoundTrip - num(pricing.minimumKmsCovered)) * num(pricing.kmsUnit),
  );
  const travelRevenue = otherRevenueDistance;
  const otherRevenue = otherRevenuePatients;
  const totalRevenue = roundMoney(campRevenue + travelRevenue + overtimeRevenue + otherRevenue);

  return {
    campRevenue: roundMoney(campRevenue),
    travelRevenue,
    overtimeRevenue,
    otherRevenuePatients,
    otherRevenueDistance,
    otherRevenue,
    totalRevenue,
  };
}

/**
 * Seed Financial-stage revenue from Client Master when empty (or force-zero Cancelled Non-Chargeable).
 * Does not overwrite non-zero manual revenue except Cancelled Non-Chargeable → all zeros.
 */
export function seedCampRevenueFromPricing(camp, pricing) {
  if (!camp || !pricing) return camp;

  const cancelled = isCampCancelledForRevenue(camp);
  const chargeable = isCampChargeable(camp);
  if (cancelled && !chargeable) {
    camp.campRevenue = 0;
    camp.travelRevenue = 0;
    camp.overtimeRevenue = 0;
    camp.otherRevenue = 0;
    camp.totalRevenue = 0;
    return camp;
  }

  const revenueEmpty = ['campRevenue', 'travelRevenue', 'overtimeRevenue', 'otherRevenue']
    .every((key) => num(camp[key]) === 0);
  if (!revenueEmpty) return camp;

  const computed = computeCampRevenueFromPricing(camp, pricing);
  camp.campRevenue = computed.campRevenue;
  camp.travelRevenue = computed.travelRevenue;
  camp.overtimeRevenue = computed.overtimeRevenue;
  camp.otherRevenue = computed.otherRevenue;
  camp.totalRevenue = computed.totalRevenue;
  return camp;
}
