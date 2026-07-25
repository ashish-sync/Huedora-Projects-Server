export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function normalizePageSize(limit) {
  const parsed = Number(limit);
  if (PAGE_SIZE_OPTIONS.includes(parsed)) return parsed;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_PAGE_SIZE);
}

export function parsePaginationQuery(query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = normalizePageSize(query.limit);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

export function buildPaginationMeta(page, limit, total) {
  return {
    page,
    limit,
    total,
    pages: Math.ceil(total / limit) || 1,
  };
}
