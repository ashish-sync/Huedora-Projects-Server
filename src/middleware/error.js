import { v4 as uuid } from 'uuid';

export function correlationId(req, res, next) {
  const id = req.headers['x-request-id'] || uuid();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const code = err.code || (status === 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
  if (status >= 500) {
    console.error('[error]', req.requestId, err);
  }
  res.status(status).json({
    error: {
      code,
      message: err.message || 'Unexpected error',
      details: err.details,
      requestId: req.requestId,
    },
  });
}

export function notFound(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
}
