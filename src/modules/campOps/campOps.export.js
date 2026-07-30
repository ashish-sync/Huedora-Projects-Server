import { CampOpsCamp } from './campOps.model.js';
import { buildCampFilter, isCampOverdue, trimStr, withCampSchedule } from './campOps.helpers.js';
import { withCampLifecycle } from './campOps.lifecycle.js';
import { withRequestReview } from './campOps.requestReview.js';
import { matchesExecutionFilter } from './campStageFilters.js';

function enrichCampForExportFilter(camp = {}) {
  const base = camp?.toObject ? camp.toObject() : camp;
  return withRequestReview(withCampLifecycle(withCampSchedule(base)));
}

export function normalizeExportQuery(query = {}) {
  const next = { ...query };
  if (next.overdue === true) next.overdue = '1';
  if (next.overdue === false) delete next.overdue;
  return next;
}

export async function fetchCampsForExport(req, query = {}, { scopeCampFilter }) {
  const normalized = normalizeExportQuery(query);
  const overdueOnly = normalized.overdue === '1' || normalized.overdue === 'true';
  const requestReviewStatus = trimStr(normalized.requestReviewStatus);
  const executionFilter = trimStr(normalized.executionFilter);
  const filter = await scopeCampFilter(req, buildCampFilter(normalized));

  if (requestReviewStatus) {
    const rows = await CampOpsCamp.find(filter).sort('-campDate -createdAt');
    return rows
      .filter((row) => enrichCampForExportFilter(row).requestReviewStatus === requestReviewStatus)
      .map((row) => row.toObject ? row.toObject() : row);
  }

  if (executionFilter) {
    const rows = await CampOpsCamp.find(filter).sort('-campDate -createdAt');
    return rows
      .map((row) => enrichCampForExportFilter(row))
      .filter((row) => matchesExecutionFilter(row, executionFilter));
  }

  if (overdueOnly) {
    filter.status = 'approved';
    const approved = await CampOpsCamp.find(filter).sort('-campDate -createdAt');
    return approved.filter(isCampOverdue).map((row) => (row.toObject ? row.toObject() : row));
  }

  const rows = await CampOpsCamp.find(filter).sort('-campDate -createdAt');
  return rows.map((row) => (row.toObject ? row.toObject() : row));
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
