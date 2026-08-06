import { v4 as uuid } from 'uuid';
import { friendlyImportMessage, IMPORT_ERROR } from '../utils/importErrors.js';

export function correlationId(req, res, next) {
  const id = req.headers['x-request-id'] || uuid();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

function isImportishRequest(req, message = '') {
  const pathHint = String(req.path || req.originalUrl || '');
  return (
    /\/import|\/parse|\/extract-file|pin-codes\/import|inventory\/|verification\/|sample/i.test(
      pathHint
    ) || /csv|xlsb|upload|spreadsheet|data rows|file type|multer/i.test(message)
  );
}

export function errorHandler(err, req, res, _next) {
  let status = err.status || 500;
  let code = err.code || (status === 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
  let message = err.message || 'Unexpected error';

  // Nested express-rate-limit body
  if (err.status === 429 || code === 'RATE_LIMIT') {
    status = 429;
    code = 'RATE_LIMIT';
    message = IMPORT_ERROR.RATE_LIMIT;
  }

  // Multer upload failures (size, unexpected field, etc.)
  if (err.name === 'MulterError' || String(err.code || '').startsWith('LIMIT_')) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = friendlyImportMessage(err);
  } else if (isImportishRequest(req, message) && status < 500) {
    message = friendlyImportMessage(err);
  }

  if (status >= 500) {
    console.error('[error]', req.requestId, err);
    if (isImportishRequest(req, message)) {
      // Avoid leaking stack internals on import endpoints
      message = IMPORT_ERROR.GENERIC;
      status = 400;
      code = 'VALIDATION_ERROR';
    }
  }

  res.status(status).json({
    error: {
      code,
      message,
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
