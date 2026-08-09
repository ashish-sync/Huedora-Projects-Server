import { normalizeCampName } from './campOps.constants.js';

/** Normalize GSTIN for the Client + GSTIN + Division + Method business key. */
export function normalizeMasterBillingGstin(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

function trimStr(value) {
  return String(value ?? '').trim();
}

/**
 * Backend uniqueness filter: Client + GSTIN + Division + Method.
 * Soft-deleted rows are excluded so archived keys can be reused.
 */
export function buildClientMasterBusinessKeyFilter({
  clientId,
  billingGstin,
  programName,
  campName,
  excludeId = null,
} = {}) {
  const filter = {
    isDeleted: false,
    clientId: String(clientId),
    billingGstin: normalizeMasterBillingGstin(billingGstin),
    programName: trimStr(programName),
    campName: normalizeCampName(campName),
  };
  if (excludeId) filter._id = { $ne: String(excludeId) };
  return filter;
}

/**
 * Copy company-level billing onto a Client Master row only where row fields are empty.
 * Used to migrate legacy rows that stored GSTIN/PAN/address on the shared company.
 * Returns true if any field was seeded (caller should persist).
 */
export function seedMasterBillingFromCompany(row, client) {
  if (!row || !client) return false;
  let changed = false;

  if (!trimStr(row.billingGstin) && trimStr(client.gstin)) {
    row.billingGstin = normalizeMasterBillingGstin(client.gstin);
    changed = true;
  }
  if (!trimStr(row.billingPan) && trimStr(client.pan)) {
    row.billingPan = trimStr(client.pan).toUpperCase();
    changed = true;
  }
  if (!trimStr(row.billingAddress) && trimStr(client.address)) {
    row.billingAddress = trimStr(client.address);
    changed = true;
  }
  if (!trimStr(row.billingStateName) && trimStr(client.stateName)) {
    row.billingStateName = trimStr(client.stateName);
    changed = true;
  }
  if (!trimStr(row.billingStateCode) && trimStr(client.stateCode)) {
    row.billingStateCode = trimStr(client.stateCode);
    changed = true;
  }

  return changed;
}

/**
 * Find filter for a legacy row that still has empty GSTIN but matches
 * Client + Division + Method (pre–per-row-billing data).
 */
export function buildLegacyEmptyGstinMatchFilter({ clientId, programName, campName } = {}) {
  return {
    isDeleted: false,
    clientId: String(clientId),
    programName: trimStr(programName),
    campName: normalizeCampName(campName),
    $or: [{ billingGstin: '' }, { billingGstin: null }, { billingGstin: { $exists: false } }],
  };
}
