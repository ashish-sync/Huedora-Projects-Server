export class AppError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST', details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function parsePagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
  const skip = (page - 1) * limit;
  const sort = query.sort || '-updatedAt';
  return { page, limit, skip, sort };
}

export function paginated(data, total, page, limit) {
  return { data, meta: { page, limit, total, pages: Math.ceil(total / limit) || 0 } };
}
