import { resolveCampSchedule } from '../campOps.helpers.js';
import {
  findExistingDuplicateCamp,
  formatDuplicateCampMessage,
  buildDuplicatePreviewFlag,
} from '../campDuplicate.js';

/**
 * Resolve the start time that create/import will actually persist
 * (blank import cells default via resolveCampSchedule).
 */
export function resolveImportDuplicateRow(row = {}, client = null) {
  const schedule = resolveCampSchedule({
    startTime: row.startTime,
    endTime: row.endTime,
    durationHours: row.durationHours,
  });
  return {
    clientName: client?.name || row.clientName,
    doctorName: row.doctorName,
    campaignType: row.campaignType,
    campDate: row.campDate,
    startTime: schedule.startTime,
  };
}

/**
 * Look up an existing camp for import/paste. Never mutates the existing row.
 * Returns { duplicate, reason, flag } or null when the row may be created.
 */
export async function findImportDuplicateToSkip({ client, row } = {}) {
  const checkRow = resolveImportDuplicateRow(row, client);
  const duplicate = await findExistingDuplicateCamp({ client, row: checkRow });
  if (!duplicate) return null;
  return {
    duplicate,
    checkRow,
    reason: formatDuplicateCampMessage(duplicate),
    flag: buildDuplicatePreviewFlag(duplicate),
  };
}

/**
 * Partition mapped import rows into creatable vs skipped-duplicates.
 * Existing camps are never updated — duplicates are listed for skip only.
 */
export async function partitionImportRowsByDuplicate({
  rows = [],
  resolveClient,
} = {}) {
  const creatable = [];
  const skippedDuplicates = [];

  for (const row of rows) {
    const client = await resolveClient(row);
    if (!client) {
      creatable.push({ row, client: null });
      continue;
    }
    const hit = await findImportDuplicateToSkip({ client, row });
    if (hit) {
      skippedDuplicates.push({
        rowNumber: row.rowNumber,
        clientName: row.clientName || client.name,
        campId: hit.duplicate.campId,
        id: hit.duplicate._id,
        reason: hit.reason,
        duplicateOf: hit.flag,
      });
      continue;
    }
    creatable.push({ row, client });
  }

  return { creatable, skippedDuplicates };
}
