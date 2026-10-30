import { CampOpsCamp } from './campOps.model.js';
import { buildCampFilter, isCampOverdue, trimStr, withCampSchedule } from './campOps.helpers.js';
import { withCampLifecycle } from './campOps.lifecycle.js';
import { withRequestReview } from './campOps.requestReview.js';
import { matchesExecutionFilter } from './campStageFilters.js';
import { MAX_CAMP_EXPORT_ROWS } from '../../utils/spreadsheetLimits.js';
import { resolveCampClientScope, filterRowsByCampClientScope } from './campOps.clientAccess.js';

function toPlainCamp(row) {
  return row && typeof row.toObject === 'function' ? row.toObject() : row;
}

function enrichCampForExportFilter(camp = {}) {
  return withRequestReview(withCampLifecycle(withCampSchedule(toPlainCamp(camp) || {})));
}

export function serializeExportTemplate(row) {
  if (!row) return row;
  const obj = toPlainCamp(row) || {};
  const id = String(obj._id || obj.id || '').trim();
  return { ...obj, id };
}

/** Keep assigned-program rows only (same post-fetch filter as Manage). */
export function applyExportProgramScope(rows, scopedAssignments) {
  return filterRowsByCampClientScope(
    (Array.isArray(rows) ? rows : []).map(toPlainCamp),
    scopedAssignments,
    { camp: true },
  );
}

export function normalizeExportQuery(query = {}) {
  const next = { ...query };
  if (next.overdue === true) next.overdue = '1';
  if (next.overdue === false) delete next.overdue;
  return next;
}

export async function fetchCampsForExport(req, query = {}, { scopeCampFilter }) {
  const MAX_CAMP_EXPORT = MAX_CAMP_EXPORT_ROWS;
  const normalized = normalizeExportQuery(query);
  const overdueOnly = normalized.overdue === '1' || normalized.overdue === 'true';
  const requestReviewStatus = trimStr(normalized.requestReviewStatus);
  const executionFilter = trimStr(normalized.executionFilter);
  const scoped = await resolveCampClientScope(req.user);
  if (Array.isArray(scoped) && scoped.length === 0) return [];

  const filter = await scopeCampFilter(req, buildCampFilter(normalized));
  const inMemoryFilter = Boolean(requestReviewStatus || executionFilter || overdueOnly || Array.isArray(scoped));
  const fetchLimit = inMemoryFilter ? MAX_CAMP_EXPORT * 4 : MAX_CAMP_EXPORT;

  const finish = (rows) => applyExportProgramScope(rows, scoped).slice(0, MAX_CAMP_EXPORT);

  if (requestReviewStatus) {
    const rows = await CampOpsCamp.find(filter).sort('-campDate -createdAt').limit(fetchLimit);
    return finish(
      rows.filter((row) => enrichCampForExportFilter(row).requestReviewStatus === requestReviewStatus),
    );
  }

  if (executionFilter) {
    const rows = await CampOpsCamp.find(filter).sort('-campDate -createdAt').limit(fetchLimit);
    return finish(
      rows
        .map((row) => enrichCampForExportFilter(row))
        .filter((row) => matchesExecutionFilter(row, executionFilter)),
    );
  }

  if (overdueOnly) {
    filter.status = 'approved';
    const approved = await CampOpsCamp.find(filter).sort('-campDate -createdAt').limit(fetchLimit);
    return finish(approved.filter(isCampOverdue));
  }

  const rows = await CampOpsCamp.find(filter).sort('-campDate -createdAt').limit(fetchLimit);
  return finish(rows);
}

export function parseExportColumnKeys(raw) {
  if (Array.isArray(raw)) {
    return raw.map((key) => String(key || '').trim()).filter(Boolean);
  }
  return String(raw || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

export function parseExportFormat(raw) {
  const value = String(raw || 'xlsx').trim().toLowerCase();
  return value === 'csv' ? 'csv' : 'xlsx';
}
