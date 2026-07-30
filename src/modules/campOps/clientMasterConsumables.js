import { CampOpsClientMaster } from './campOps.model.js';

function trimStr(value) {
  return String(value ?? '').trim();
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
  const division = trimStr(campaignType);
  const method = trimStr(campaignName);
  const activeRecords = records.filter((record) => record?.isActive !== false);

  if (division && method) {
    const exact = activeRecords.find((record) => (
      trimStr(record.programName) === division
      && trimStr(record.campName) === method
    ));
    const exactMapped = normalizeMappedConsumables(exact?.mappedConsumables || []);
    if (exactMapped.length) return exactMapped;
  }

  const merged = new Map();
  for (const record of activeRecords) {
    for (const item of normalizeMappedConsumables(record.mappedConsumables || [])) {
      merged.set(item.productId, item);
    }
  }
  return [...merged.values()];
}

export async function resolveMappedConsumablesForCamp(clientId, { campaignType = '', campaignName = '' } = {}) {
  if (!clientId) return [];
  const records = await CampOpsClientMaster.find({
    isDeleted: false,
    clientId: String(clientId),
  }).sort('programName');
  return resolveMappedConsumablesFromRecords(records, { campaignType, campaignName });
}
