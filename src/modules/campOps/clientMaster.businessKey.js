import { normalizeCampName } from './campOps.constants.js';
import { cleanMultilineAddress } from '../../utils/textFormat.js';

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

export function trimMasterBillingAddress(value) {
  return cleanMultilineAddress(value);
}

const EXPLICIT_BILLING_KEYS = [
  'billingAddress',
  'address',
  'billingGstin',
  'gstin',
  'GSTIN',
  'billingPan',
  'pan',
  'panNumber',
  'billingStateName',
  'stateName',
  'state',
  'billingStateCode',
  'stateCode',
];

/** True when the client sent Billing & Tax fields (section save), not a program-only patch. */
export function hasExplicitMasterBilling(body = {}) {
  if (body?.billing != null && typeof body.billing === 'object') return true;
  return EXPLICIT_BILLING_KEYS.some((key) => body[key] !== undefined);
}

/**
 * Map body.billing / flat aliases onto per-row billing fields (never onto the company).
 * Explicit values always win — including extra address lines — so company fallback
 * cannot restore an older address after a Billing & Tax save.
 */
export function applyMasterBillingFields(target, body = {}) {
  if (!target || typeof target !== 'object') return target;
  const nested = body.billing && typeof body.billing === 'object' ? body.billing : {};
  const read = (...keys) => {
    for (const key of keys) {
      if (body[key] !== undefined) return body[key];
      if (nested[key] !== undefined) return nested[key];
    }
    return undefined;
  };

  const address = read('billingAddress', 'address');
  const gstin = read('billingGstin', 'gstin', 'GSTIN');
  const pan = read('billingPan', 'pan', 'panNumber');
  const stateName = read('billingStateName', 'stateName', 'state');
  const stateCode = read('billingStateCode', 'stateCode');

  if (address !== undefined) target.billingAddress = trimMasterBillingAddress(address);
  if (gstin !== undefined) target.billingGstin = normalizeMasterBillingGstin(gstin);
  if (pan !== undefined) target.billingPan = trimStr(pan).toUpperCase();
  if (stateName !== undefined) target.billingStateName = trimStr(stateName);
  if (stateCode !== undefined) target.billingStateCode = trimStr(stateCode);
  return target;
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
