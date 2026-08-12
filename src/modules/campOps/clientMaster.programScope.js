import { normalizeCampName } from './campOps.constants.js';
import { parseAssignedUserEmails } from './campOps.clientAccess.js';
import { CampOpsClientMaster } from './campOps.model.js';

function trimStr(value) {
  return String(value ?? '').trim();
}

export function normalizeProgramDivisionKey(value) {
  return trimStr(value)
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ');
}

export function normalizeProgramMethodKey(value) {
  return normalizeProgramDivisionKey(normalizeCampName(value) || value);
}

export function masterDivisionLabel(record = {}) {
  return trimStr(record.programName || record.drugTherapyName);
}

export function masterMethodLabel(record = {}) {
  return trimStr(normalizeCampName(record.campName) || record.campName);
}

export function masterMatchesProgramScope(record, scope = {}, { excludeId = null } = {}) {
  if (!record || record.isDeleted) return false;
  if (excludeId && String(record._id) === String(excludeId)) return false;
  if (scope.clientId && String(record.clientId) !== String(scope.clientId)) return false;
  if (scope.clientName) {
    const want = normalizeProgramDivisionKey(scope.clientName);
    const have = normalizeProgramDivisionKey(record.clientName);
    if (want && have !== want) return false;
  }
  if (scope.programName) {
    const want = normalizeProgramDivisionKey(scope.programName);
    const have = normalizeProgramDivisionKey(masterDivisionLabel(record));
    if (want && have !== want) return false;
  }
  if (scope.campName) {
    const want = normalizeProgramMethodKey(scope.campName);
    const have = normalizeProgramMethodKey(masterMethodLabel(record));
    if (want && have !== want) return false;
  }
  return Boolean(scope.programName && scope.campName);
}

export function campMatchesProgramAssignment(camp = {}, assignment = {}) {
  if (!camp || !assignment?.clientId) return false;
  const campClientId = String(camp.clientId || '').trim();
  if (!campClientId || campClientId.toLowerCase() !== String(assignment.clientId).trim().toLowerCase()) {
    return false;
  }
  const divisionKey = normalizeProgramDivisionKey(assignment.programName);
  const methodKey = normalizeProgramMethodKey(assignment.campName);
  if (!divisionKey || !methodKey) return false;
  return (
    normalizeProgramDivisionKey(camp.campaignType) === divisionKey
    && normalizeProgramMethodKey(camp.campaignName) === methodKey
  );
}

export function unionAssignedUserEmails(entries = []) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const emails = Array.isArray(entry?.emails)
      ? entry.emails
      : parseAssignedUserEmails(entry?.assignedUserEmails ?? entry);
    for (const email of emails) {
      const key = String(email || '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(String(email).trim());
    }
  }
  return out;
}

/** Union assigned login emails across masters sharing client + division + method. */
export function resolveAssignedUserEmailsFromRecords(records = [], {
  programName = '',
  campName = '',
} = {}) {
  const divisionKey = normalizeProgramDivisionKey(programName);
  const methodKey = normalizeProgramMethodKey(campName);
  if (!divisionKey || !methodKey) return [];

  const activeRecords = (Array.isArray(records) ? records : []).filter(
    (record) => record?.isActive !== false && !record?.isDeleted,
  );
  const exact = activeRecords.filter((record) => (
    normalizeProgramDivisionKey(masterDivisionLabel(record)) === divisionKey
    && normalizeProgramMethodKey(masterMethodLabel(record)) === methodKey
  ));
  return unionAssignedUserEmails(exact);
}

export function filterMastersByProgramAssignments(rows = [], assignments = []) {
  if (!assignments?.length) return [];
  return (Array.isArray(rows) ? rows : []).filter((row) => (
    assignments.some((assignment) => masterMatchesProgramScope(row, assignment))
  ));
}

export function filterCampsByProgramAssignments(camps = [], assignments = []) {
  if (!assignments?.length) return [];
  return (Array.isArray(camps) ? camps : []).filter((camp) => (
    assignments.some((assignment) => campMatchesProgramAssignment(camp, assignment))
  ));
}

export function clientIdsFromProgramAssignments(assignments = []) {
  return [...new Set(
    (Array.isArray(assignments) ? assignments : [])
      .map((item) => String(item?.clientId || '').trim())
      .filter(Boolean),
  )];
}

export async function syncAssignedUserEmailsForProgramScope(sourceRow, emails = []) {
  if (!sourceRow?.clientId) return 0;
  const normalized = parseAssignedUserEmails(emails);
  const scope = {
    clientId: sourceRow.clientId,
    clientName: sourceRow.clientName,
    programName: sourceRow.programName,
    campName: sourceRow.campName,
  };
  const siblings = await CampOpsClientMaster.find({
    isDeleted: false,
    clientId: String(sourceRow.clientId),
  });
  let updated = 0;
  for (const row of siblings) {
    if (!masterMatchesProgramScope(row, scope, { excludeId: sourceRow._id })) continue;
    row.assignedUserEmails = [...normalized];
    await row.save();
    updated += 1;
  }
  return updated;
}
