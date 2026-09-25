/**
 * Soft response-size guard for JSON APIs.
 * Stringifies once (no double JSON.stringify), measures that payload, then sends it.
 * Does not truncate responses (preserves functionality).
 */
export function responseSizeGuard({ warnBytes = 750_000 } = {}) {
  return function responseSizeGuardMiddleware(req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      try {
        if (typeof body === 'string') {
          const size = Buffer.byteLength(body, 'utf8');
          maybeWarn(req, res, size, warnBytes);
          return originalJson(body);
        }
        // Single serialize: measure + send the same bytes Express would emit.
        const payload = JSON.stringify(body ?? null);
        const size = Buffer.byteLength(payload, 'utf8');
        maybeWarn(req, res, size, warnBytes);
        if (!res.getHeader('Content-Type')) {
          res.set('Content-Type', 'application/json; charset=utf-8');
        }
        return res.send(payload);
      } catch {
        return originalJson(body);
      }
    };
    next();
  };
}

function maybeWarn(req, res, size, warnBytes) {
  if (size < warnBytes) return;
  console.warn(
    `[perf] large JSON response ${size} bytes path=${req.originalUrl || req.url} status=${res.statusCode || 200}`,
  );
  res.set('X-Response-Size-Bytes', String(size));
  res.set('X-Response-Size-Warning', 'true');
}
