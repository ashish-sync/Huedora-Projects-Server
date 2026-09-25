/**
 * Soft response-size guard for JSON APIs.
 * Logs oversized payloads so free-tier OOM/latency regressions are visible.
 * Does not truncate responses (preserves functionality).
 */
export function responseSizeGuard({ warnBytes = 750_000 } = {}) {
  return function responseSizeGuardMiddleware(_req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      try {
        const size = Buffer.byteLength(
          typeof body === 'string' ? body : JSON.stringify(body ?? null),
          'utf8',
        );
        if (size >= warnBytes) {
          console.warn(
            `[perf] large JSON response ${size} bytes path=${_req.originalUrl || _req.url} status=${res.statusCode || 200}`,
          );
          res.set('X-Response-Size-Bytes', String(size));
          res.set('X-Response-Size-Warning', 'true');
        }
      } catch {
        /* ignore measurement failures */
      }
      return originalJson(body);
    };
    next();
  };
}
