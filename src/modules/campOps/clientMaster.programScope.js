import { CAMP_NAME_OPTIONS, normalizeCampName } from './campOps.constants.js';
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

/**
 * Client Master programs that list `email` as an Assigned User.
 * Returns null when no email is provided (caller should skip the filter).
 */
export function programAssignmentsForAssignedUser(records = [], {
  email = '',
  clientId = '',
  programName = '',
  campName = '',
} = {}) {
  const wantEmail = trimStr(email).toLowerCase();
  if (!wantEmail) return null;

  const wantClient = trimStr(clientId).toLowerCase();
  const wantDivision = programName ? normalizeProgramDivisionKey(programName) : '';
  const wantMethod = campName ? normalizeProgramMethodKey(campName) : '';

  const assignments = [];
  const seen = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || record.isDeleted || record.isActive === false) continue;
    const recordClient = trimStr(record.clientId);
    if (wantClient && recordClient.toLowerCase() !== wantClient) continue;
    const emails = parseAssignedUserEmails(record.assignedUserEmails);
    if (!emails.includes(wantEmail)) continue;
    const division = masterDivisionLabel(record);
    const method = masterMethodLabel(record);
    if (!division || !method) continue;
    if (wantDivision && normalizeProgramDivisionKey(division) !== wantDivision) continue;
    if (wantMethod && normalizeProgramMethodKey(method) !== wantMethod) continue;
    const key = `${recordClient.toLowerCase()}\0${normalizeProgramDivisionKey(division)}\0${normalizeProgramMethodKey(method)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    assignments.push({
      clientId: recordClient,
      programName: division,
      campName: method,
    });
  }
  return assignments;
}

export function applyAssignedUserAssignmentsToFilter(filter = {}, assignments) {
  if (assignments == null) return filter;
  if (!assignments.length) {
    return { ...filter, _id: '__none__' };
  }
  const or = assignments.map((assignment) => ({
    clientId: assignment.clientId,
    campaignType: assignment.programName,
    campaignName: assignment.campName,
  }));
  return {
    ...filter,
    $and: [...(filter.$and || []), { $or: or }],
  };
}

/** Restrict camps to Client Master programs that list the selected Assigned User. */
function methodSortIndex(value) {
  const index = CAMP_NAME_OPTIONS.indexOf(value);
  return index === -1 ? CAMP_NAME_OPTIONS.length : index;
}

function upsertNamedId(map, id, name) {
  const key = trimStr(id);
  if (!key || map.has(key)) return;
  map.set(key, { _id: key, name: trimStr(name) || key });
}

/**
 * Method → Division → Client cascade plus independent Assigned Users,
 * derived from Client Master program rows.
 */
export function buildOpsBoardFilterCatalog(records = [], { clients = [], users = [] } = {}) {
  const clientNameById = new Map();
  for (const client of Array.isArray(clients) ? clients : []) {
    const id = trimStr(client?._id || client?.id);
    if (!id) continue;
    clientNameById.set(id, trimStr(client?.name || client?.displayName));
  }

  const userNameByEmail = new Map();
  for (const user of Array.isArray(users) ? users : []) {
    const email = trimStr(user?.email).toLowerCase();
    if (!email) continue;
    userNameByEmail.set(email, trimStr(user?.fullName || user?.name));
  }

  const methodSet = new Set();
  const divisionsByMethod = new Map();
  const clientsByMethod = new Map();
  const clientsByMethodDivision = new Map();
  const assignedSeen = new Set();
  const assignedEmails = [];

  for (const record of Array.isArray(records) ? records : []) {
    if (!record || record.isDeleted || record.isActive === false) continue;
    const method = masterMethodLabel(record);
    const division = masterDivisionLabel(record);
    const clientId = trimStr(record.clientId);
    if (!method || !division) continue;

    methodSet.add(method);
    if (!divisionsByMethod.has(method)) divisionsByMethod.set(method, new Set());
    divisionsByMethod.get(method).add(division);

    const clientName = clientNameById.get(clientId) || trimStr(record.clientName) || clientId;
    if (clientId) {
      if (!clientsByMethod.has(method)) clientsByMethod.set(method, new Map());
      upsertNamedId(clientsByMethod.get(method), clientId, clientName);
      const scopeKey = `${method}\0${division}`;
      if (!clientsByMethodDivision.has(scopeKey)) clientsByMethodDivision.set(scopeKey, new Map());
      upsertNamedId(clientsByMethodDivision.get(scopeKey), clientId, clientName);
    }

    for (const email of parseAssignedUserEmails(record.assignedUserEmails)) {
      if (assignedSeen.has(email)) continue;
      assignedSeen.add(email);
      assignedEmails.push(email);
    }
  }

  const methods = [...methodSet].sort((a, b) => {
    const byCanon = methodSortIndex(a) - methodSortIndex(b);
    return byCanon !== 0 ? byCanon : a.localeCompare(b);
  });

  const divisionsByMethodObj = {};
  for (const method of methods) {
    divisionsByMethodObj[method] = [...(divisionsByMethod.get(method) || [])]
      .sort((a, b) => a.localeCompare(b));
  }

  const clientsByMethodObj = {};
  for (const [method, map] of clientsByMethod) {
    clientsByMethodObj[method] = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  const clientsByMethodDivisionObj = {};
  for (const [key, map] of clientsByMethodDivision) {
    const sep = key.indexOf('\0');
    const method = key.slice(0, sep);
    const division = key.slice(sep + 1);
    if (!clientsByMethodDivisionObj[method]) clientsByMethodDivisionObj[method] = {};
    clientsByMethodDivisionObj[method][division] = [...map.values()]
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const assignedUsers = assignedEmails
    .map((email) => ({
      email,
      name: userNameByEmail.get(email) || '',
    }))
    .sort((a, b) => {
      const left = (a.name || a.email).toLowerCase();
      const right = (b.name || b.email).toLowerCase();
      return left.localeCompare(right) || a.email.localeCompare(b.email);
    });

  return {
    methods,
    divisionsByMethod: divisionsByMethodObj,
    clientsByMethod: clientsByMethodObj,
    clientsByMethodDivision: clientsByMethodDivisionObj,
    assignedUsers,
  };
}

export async function applyAssignedUserCampFilter(filter, query = {}) {
  const email = trimStr(query.assignedUser || query.assignedUserEmail);
  if (!email) return filter;
  const clientId = trimStr(query.client || query.clientId);
  const masterFilter = { isDeleted: false };
  if (clientId) masterFilter.clientId = clientId;
  const records = await CampOpsClientMaster.find(masterFilter);
  const assignments = programAssignmentsForAssignedUser(records, {
    email,
    clientId,
    programName: query.campaignType,
    campName: query.campaign || query.campaignName,
  });
  return applyAssignedUserAssignmentsToFilter(filter, assignments);
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
