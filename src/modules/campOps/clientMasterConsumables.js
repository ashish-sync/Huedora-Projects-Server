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

export function normalizeMappedConsumables(rows = []) {
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  return rows
    .map((row) => ({
      productId: trimStr(row?.productId || row?.id),
      itemName: trimStr(row?.itemName || row?.name),
      unit: trimStr(row?.unit),
      uomId: trimStr(row?.uomId),
    }))
    .filter((row) => {
      if (!row.productId || seen.has(row.productId)) return false;
      seen.add(row.productId);
      return true;
    });
}

export function resolveMappedConsumablesFromRecords(records = [], { campaignType = '', campaignName = '' } = {}) {
  const divisionKey = normalizeDivisionKey(campaignType);
  const methodKey = normalizeMethodKey(campaignName);
  const activeRecords = records.filter((record) => record?.isActive !== false);

  if (divisionKey && methodKey) {
    const exact = activeRecords.find((record) => (
      normalizeDivisionKey(record.programName || record.drugTherapyName) === divisionKey
      && normalizeMethodKey(record.campName) === methodKey
    ));
    const exactMapped = normalizeMappedConsumables(exact?.mappedConsumables || []);
    if (exactMapped.length) return exactMapped;
  }

  if (divisionKey) {
    const byDivision = activeRecords.find((record) => (
      normalizeDivisionKey(record.programName || record.drugTherapyName) === divisionKey
    ));
    const mapped = normalizeMappedConsumables(byDivision?.mappedConsumables || []);
    if (mapped.length) return mapped;
  }

  const merged = new Map();
  for (const record of activeRecords) {
    for (const item of normalizeMappedConsumables(record.mappedConsumables || [])) {
      if (!merged.has(item.productId)) merged.set(item.productId, item);
    }
  }
  return [...merged.values()];
}

export async function resolveMappedConsumablesForCamp(clientId, {
  campaignType = '',
  campaignName = '',
  clientName = '',
} = {}) {
  if (!clientId && !clientName) return [];
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

  return resolveMappedConsumablesFromRecords(records, { campaignType, campaignName });
}
