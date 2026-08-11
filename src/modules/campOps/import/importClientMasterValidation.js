import { CampOpsClient, CampOpsClientMaster } from '../campOps.model.js';
import { normalizeCampName } from '../campOps.constants.js';
import { validateMappedImportRows } from '../campOps.helpers.js';

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

function divisionLabel(record = {}) {
  return trimStr(record.programName || record.drugTherapyName);
}

function isActiveMaster(record = {}) {
  return record?.isActive !== false;
}

function groupMastersByDivision(records = []) {
  const map = new Map();
  for (const record of records.filter(isActiveMaster)) {
    const label = divisionLabel(record);
    const divisionKey = normalizeDivisionKey(label);
    if (!divisionKey) continue;

    if (!map.has(divisionKey)) {
      map.set(divisionKey, {
        label,
        methods: new Map(),
      });
    }
    const entry = map.get(divisionKey);
    const methodLabel = trimStr(normalizeCampName(record.campName) || record.campName);
    const methodKey = normalizeMethodKey(methodLabel);
    if (methodKey && !entry.methods.has(methodKey)) {
      entry.methods.set(methodKey, methodLabel);
    }
  }
  return map;
}

export async function buildClientMasterImportCatalog() {
  const [clients, masters] = await Promise.all([
    CampOpsClient.find({ isDeleted: false }),
    CampOpsClientMaster.find({ isDeleted: false }),
  ]);

  const clientsByName = new Map();
  for (const client of clients) {
    const name = trimStr(client.name);
    if (!name) continue;
    clientsByName.set(name.toLowerCase(), {
      id: String(client._id),
      name,
    });
  }

  const mastersByClientId = new Map();
  const mastersByClientName = new Map();

  for (const master of masters.filter(isActiveMaster)) {
    const clientId = trimStr(master.clientId);
    const clientName = trimStr(master.clientName).toLowerCase();

    if (clientId) {
      if (!mastersByClientId.has(clientId)) mastersByClientId.set(clientId, []);
      mastersByClientId.get(clientId).push(master);
    }
    if (clientName) {
      if (!mastersByClientName.has(clientName)) mastersByClientName.set(clientName, []);
      mastersByClientName.get(clientName).push(master);
    }
  }

  return { clientsByName, mastersByClientId, mastersByClientName };
}

function resolveMasterRecordsForClient(catalog, clientEntry, clientNameLower) {
  const byId = catalog.mastersByClientId.get(clientEntry.id) || [];
  if (byId.length) return byId;
  return catalog.mastersByClientName.get(clientNameLower) || [];
}

export function getClientMasterImportErrors(row = {}, catalog = null) {
  if (!catalog) return [];

  const errors = [];
  const clientName = trimStr(row.clientName);
  const division = trimStr(row.campaignType);
  const method = trimStr(row.campaignName);

  if (!clientName) {
    errors.push('Client name is required');
    return errors;
  }

  const clientKey = clientName.toLowerCase();
  const clientEntry = catalog.clientsByName.get(clientKey);
  if (!clientEntry) {
    errors.push(`Client "${clientName}" is not configured. Add the client in Clients and Client Master first.`);
    return errors;
  }

  const masterRecords = resolveMasterRecordsForClient(catalog, clientEntry, clientKey);
  if (!masterRecords.length) {
    errors.push(`No Client Master programs exist for "${clientName}".`);
    return errors;
  }

  const divisions = groupMastersByDivision(masterRecords);
  const divisionEntry = division ? divisions.get(normalizeDivisionKey(division)) : null;

  if (!division) {
    errors.push('Division / Therapy is required');
  } else if (!divisionEntry) {
    const allowed = [...divisions.values()].map((item) => item.label).filter(Boolean);
    errors.push(
      allowed.length
        ? `Division / Therapy "${division}" is not configured for ${clientName} in Client Master. Allowed: ${allowed.join(', ')}`
        : `Division / Therapy "${division}" is not configured for ${clientName} in Client Master.`,
    );
  }

  if (!method) {
    errors.push('Method is required');
  } else if (divisionEntry && !divisionEntry.methods.has(normalizeMethodKey(method))) {
    const allowedMethods = [...divisionEntry.methods.values()];
    errors.push(
      allowedMethods.length
        ? `Method "${method}" is not configured for ${clientName} / ${divisionEntry.label} in Client Master. Allowed: ${allowedMethods.join(', ')}`
        : `Method "${method}" is not configured for ${clientName} / ${divisionEntry.label} in Client Master.`,
    );
  } else if (method && !division) {
    errors.push('Method requires a valid Division / Therapy from Client Master');
  }

  return errors;
}

export function applyClientMasterValidationToResult(result = {}, catalog = null) {
  if (!catalog) return result;

  const validRows = [];
  const invalidRows = [...(result.invalidRows || [])];
  const partialRows = [];

  for (const row of result.validRows || []) {
    const cmErrors = getClientMasterImportErrors(row, catalog);
    if (cmErrors.length) {
      invalidRows.push({ ...row, errors: cmErrors });
    } else {
      validRows.push(row);
    }
  }

  for (const row of result.partialRows || []) {
    const cmErrors = getClientMasterImportErrors(row, catalog);
    if (cmErrors.length) {
      invalidRows.push({
        ...row,
        errors: [...new Set([...(Array.isArray(row.errors) ? row.errors : []), ...cmErrors])],
        partial: false,
        creationEligible: false,
        reviewStatus: 'REVIEW_REQUIRED',
      });
    } else {
      partialRows.push(row);
    }
  }

  return {
    ...result,
    validRows,
    invalidRows,
    partialRows,
  };
}

export async function validateMappedImportRowsWithClientMaster(rows, options = {}) {
  const catalog = await buildClientMasterImportCatalog();
  const result = validateMappedImportRows(rows, options);
  return applyClientMasterValidationToResult(result, catalog);
}

export function applyClientMasterErrorsToPasteEntry(entry = {}, catalog = null) {
  if (!catalog || !entry?.row) return entry;
  const cmErrors = getClientMasterImportErrors(entry.row, catalog);
  if (!cmErrors.length) return entry;
  return {
    ...entry,
    valid: false,
    partial: false,
    creationEligible: false,
    reviewStatus: 'REVIEW_REQUIRED',
    errors: [...new Set([...(entry.errors || []), ...cmErrors])],
  };
}
