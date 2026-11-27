import { CampOpsCamp } from './campOps.model.js';
import { buildCampFilter, isCampOverdue, trimStr } from './campOps.helpers.js';
import { matchesExecutionFilter } from './campStageFilters.js';
import {
  cheapEffectiveCamp,
  cheapIsOverdue,
  cheapRequestReviewStatus,
} from './campOps.listDto.js';
import { MAX_CAMP_EXPORT_ROWS } from '../../utils/spreadsheetLimits.js';
import { resolveCampClientScope, filterRowsByCampClientScope } from './campOps.clientAccess.js';

function toPlainCamp(row) {
  return row && typeof row.toObject === 'function' ? row.toObject() : row;
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

export function campIdsFromRows(rows = []) {
  return [...new Set(
    (rows || [])
      .map((row) => String(row?.campId || '').trim())
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b));
}

/**
 * Diff list vs export Camp ID sets for the same filter universe.
 */
export function diffCampIdSets(listIds = [], exportIds = []) {
  const list = new Set(listIds);
  const exported = new Set(exportIds);
  return {
    missingFromExport: listIds.filter((id) => !exported.has(id)),
    extraInExport: exportIds.filter((id) => !list.has(id)),
    listCount: listIds.length,
    exportCount: exportIds.length,
  };
}

/**
 * Apply the same in-memory predicates used by GET /camps list paging.
 * Uses cheap* helpers so list and export cannot drift.
 */
export function filterCampsForExportPredicates(rows = [], query = {}) {
  const overdueOnly = query.overdue === '1' || query.overdue === 'true';
  const requestReviewStatus = trimStr(query.requestReviewStatus);
  const executionFilter = trimStr(query.executionFilter);
  let next = (rows || []).map(toPlainCamp);

  if (requestReviewStatus) {
    next = next.filter((row) => cheapRequestReviewStatus(row, requestReviewStatus));
  }
  if (executionFilter) {
    next = next.filter((row) => matchesExecutionFilter(cheapEffectiveCamp(row), executionFilter));
  }
  if (overdueOnly) {
    next = next.filter((row) => cheapIsOverdue(row) || isCampOverdue(row));
  }
  return next;
}

/**
 * Fetch camps for Excel/CSV export.
 * - Mongo/File filter mirrors Manage via buildCampFilter + scopeCampFilter.
 * - In-memory predicates mirror list (cheapRequestReviewStatus / execution / overdue).
 * - Does NOT pre-truncate before those predicates (root cause of missing Camp IDs).
 * - Final spreadsheet cap still applies; truncated=true when matched > cap.
 */
export async function fetchCampsForExport(req, query = {}, { scopeCampFilter }) {
  const MAX_CAMP_EXPORT = MAX_CAMP_EXPORT_ROWS;
  const normalized = normalizeExportQuery(query);
  const overdueOnly = normalized.overdue === '1' || normalized.overdue === 'true';
  const requestReviewStatus = trimStr(normalized.requestReviewStatus);
  const executionFilter = trimStr(normalized.executionFilter);
  const scoped = await resolveCampClientScope(req.user);
  if (Array.isArray(scoped) && scoped.length === 0) {
    return { camps: [], truncated: false, matchedCount: 0, returnedCount: 0 };
  }

  const filter = await scopeCampFilter(req, buildCampFilter(normalized));
  if (overdueOnly) {
    filter.status = 'approved';
  }

  const needsInMemoryPredicates = Boolean(requestReviewStatus || executionFilter || overdueOnly);

  // Unrestricted find for predicate paths — never drop rows before JS filters.
  // Direct path: fetch one past the cap so we can detect truncation.
  const cursor = CampOpsCamp.find(filter).sort('-campDate -createdAt');
  const rows = needsInMemoryPredicates
    ? await cursor.exec()
    : await cursor.limit(MAX_CAMP_EXPORT + 1).exec();

  let matched = filterCampsForExportPredicates(rows, normalized);
  matched = applyExportProgramScope(matched, scoped);

  const matchedCount = matched.length;
  const truncated = matchedCount > MAX_CAMP_EXPORT;
  const camps = truncated ? matched.slice(0, MAX_CAMP_EXPORT) : matched;

  return {
    camps,
    truncated,
    matchedCount,
    returnedCount: camps.length,
  };
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
