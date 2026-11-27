/**
 * Read-only Camp One UI-vs-export Camp ID discrepancy report (FileDB / Mongo).
 *
 * Usage:
 *   node scripts/camp-export-discrepancy-report.mjs
 *   node scripts/camp-export-discrepancy-report.mjs --dateFrom=2026-10-01 --dateTo=2026-12-31
 *
 * Does not modify camps or Camp IDs.
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import { buildCampFilter } from '../src/modules/campOps/campOps.helpers.js';
import {
  fetchCampsForExport,
  campIdsFromRows,
  diffCampIdSets,
  filterCampsForExportPredicates,
} from '../src/modules/campOps/campOps.export.js';
import { CampOpsCamp } from '../src/modules/campOps/campOps.model.js';
import { cheapRequestReviewStatus, cheapEffectiveCamp } from '../src/modules/campOps/campOps.listDto.js';
import { matchesExecutionFilter } from '../src/modules/campOps/campStageFilters.js';

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
}

const SLICES = [
  { label: 'all_live', query: {} },
  { label: 'request_review_pending', query: { lifecycleStage: 'request', requestReviewStatus: 'review_pending' } },
  { label: 'request_review_overdue', query: { lifecycleStage: 'request', requestReviewStatus: 'review_overdue' } },
  { label: 'execution_board', query: { boardStage: 'execution' } },
  { label: 'financial_exclude_cancelled', query: { lifecycleStage: 'financial', excludeBoardCancelled: '1' } },
  { label: 'status_cancelled', query: { status: 'cancelled' } },
  { label: 'status_rejected', query: { status: 'rejected' } },
];

async function listIdsForQuery(query) {
  const filter = buildCampFilter(query);
  const rows = await CampOpsCamp.find(filter).exec();
  let matched = rows;
  const requestReviewStatus = String(query.requestReviewStatus || '').trim();
  const executionFilter = String(query.executionFilter || '').trim();
  if (requestReviewStatus) {
    matched = matched.filter((row) => cheapRequestReviewStatus(row, requestReviewStatus));
  }
  if (executionFilter) {
    matched = matched.filter((row) => matchesExecutionFilter(cheapEffectiveCamp(row), executionFilter));
  }
  // Keep export predicate helper in sync for overdue / shared paths
  matched = filterCampsForExportPredicates(matched, query);
  return campIdsFromRows(matched);
}

async function main() {
  await connectDb();
  const dateFrom = argValue('dateFrom');
  const dateTo = argValue('dateTo');
  const datePatch = {};
  if (dateFrom) datePatch.dateFrom = dateFrom;
  if (dateTo) datePatch.dateTo = dateTo;

  const req = { user: { systemRole: 'Admin' }, query: {} };
  const scopeCampFilter = async (_req, filter) => filter;

  const report = {
    generatedAt: new Date().toISOString(),
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    slices: [],
  };

  for (const slice of SLICES) {
    const query = { ...slice.query, ...datePatch };
    const listIds = await listIdsForQuery(query);
    const exported = await fetchCampsForExport(req, query, { scopeCampFilter });
    const exportIds = campIdsFromRows(exported.camps);
    const diff = diffCampIdSets(listIds, exportIds);
    report.slices.push({
      label: slice.label,
      query,
      listCount: listIds.length,
      exportCount: exportIds.length,
      truncated: exported.truncated,
      matchedCount: exported.matchedCount,
      missingFromExport: diff.missingFromExport,
      extraInExport: diff.extraInExport,
      ok: diff.missingFromExport.length === 0 && diff.extraInExport.length === 0,
    });
  }

  console.log(JSON.stringify(report, null, 2));
  const failed = report.slices.filter((s) => !s.ok);
  if (failed.length) {
    console.error(`[discrepancy] ${failed.length} slice(s) have Camp ID mismatches`);
    process.exitCode = 2;
  } else {
    console.error('[discrepancy] All slices: list Camp IDs ⊆ export Camp IDs (parity OK)');
  }
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
