import { v4 as uuid } from 'uuid';
import { friendlyImportMessage, IMPORT_ERROR } from '../utils/importErrors.js';
import { friendlyUploadMessage, isTabularImportPath } from '../utils/uploadErrors.js';
import { discardRequestUploads } from '../storage/uploadLifecycle.js';

export function correlationId(req, res, next) {
  const id = req.headers['x-request-id'] || uuid();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

/** True only for real spreadsheet/tabular import endpoints — not every upload. */
function isImportishRequest(req) {
  return isTabularImportPath(req);
}

export function errorHandler(err, req, res, _next) {
  // Best-effort: remove deferred disk uploads that never committed
  if (req) {
    discardRequestUploads(req, { force: true }).catch(() => {});
  }

  let status = err.status || 500;
  let code = err.code || (status === 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
  let message = err.message || 'Unexpected error';

  const importish = isImportishRequest(req);
  const isMulter =
    err.name === 'MulterError' || String(err.code || '').startsWith('LIMIT_');

  // Rate limits: keep caller message when present; import routes get import copy
  if (err.status === 429 || code === 'RATE_LIMIT' || code === 'AI_RATE_LIMITED') {
    status = 429;
    if (importish || code === 'RATE_LIMIT') {
      code = code === 'AI_RATE_LIMITED' ? 'AI_RATE_LIMITED' : 'RATE_LIMIT';
      if (importish && code === 'RATE_LIMIT') {
        message = IMPORT_ERROR.RATE_LIMIT;
      } else if (!message || message === 'Unexpected error') {
        message =
          code === 'AI_RATE_LIMITED'
            ? 'Too many AI requests right now. Wait a minute and try again.'
            : 'Too many requests. Wait a few minutes and try again.';
      }
    } else {
      code = code === 'AI_RATE_LIMITED' ? 'AI_RATE_LIMITED' : 'RATE_LIMIT';
      if (!err.message) {
        message = 'Too many requests. Wait a few minutes and try again.';
      }
    }
  } else if (isMulter) {
    status = status === 413 ? 413 : 400;
    code = 'FILE_TOO_LARGE';
    if (importish) {
      message = friendlyImportMessage(err);
      code = 'VALIDATION_ERROR';
    } else {
      const maxBytes = Number(req?.uploadMaxBytes) || undefined;
      message = friendlyUploadMessage(err, { maxBytes });
      if (/LIMIT_FILE_SIZE/i.test(String(err.code || err.message || ''))) {
        status = 413;
        code = 'FILE_TOO_LARGE';
      } else {
        code = 'VALIDATION_ERROR';
      }
    }
  } else if (importish && status < 500) {
    message = friendlyImportMessage(err);
  }

  if (status >= 500) {
    console.error('[error]', req.requestId, err);
    if (importish) {
      message = IMPORT_ERROR.GENERIC;
      status = 400;
      code = 'VALIDATION_ERROR';
    } else {
      message = message && message !== 'Unexpected error' ? message : 'Something went wrong. Please try again.';
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
