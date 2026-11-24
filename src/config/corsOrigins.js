import { env } from './env.js';

function stripSlash(origin) {
  return String(origin || '').trim().replace(/\/$/, '');
}

function originWithHost(url, hostname) {
  const port = url.port ? `:${url.port}` : '';
  return `${url.protocol}//${hostname}${port}`;
}

function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/**
 * Browser origins allowed to call the API with credentials.
 * CLIENT_ORIGIN may be a single URL or a comma-separated list.
 * Also allow the www / apex twin so Prod cookies and CORS survive both hosts,
 * and localhost ↔ 127.0.0.1 twins for local Vite.
 */
export function allowedClientOrigins(clientOrigin = env.clientOrigin) {
  const raw = String(clientOrigin || '')
    .split(',')
    .map(stripSlash)
    .filter(Boolean);
  const extra = [];
  for (const origin of raw) {
    try {
      const url = new URL(origin);
      if (url.hostname.startsWith('www.')) {
        extra.push(originWithHost(url, url.hostname.slice(4)));
      } else if (url.hostname.includes('.')) {
        extra.push(originWithHost(url, `www.${url.hostname}`));
      }
      if (url.hostname === 'localhost') {
        extra.push(originWithHost(url, '127.0.0.1'));
      } else if (url.hostname === '127.0.0.1') {
        extra.push(originWithHost(url, 'localhost'));
      }
    } catch {
      /* ignore malformed */
    }
  }
  return [...new Set([...raw, ...extra])];
}

function configuredHasLocalOrigin(clientOrigin = env.clientOrigin) {
  return allowedClientOrigins(clientOrigin).some((origin) => {
    try {
      return isLoopbackHost(new URL(origin).hostname);
    } catch {
      return false;
    }
  });
}

/**
 * In local development Vite may bump 5173 → 5174+ when another app holds the
 * default port, and browsers may send either localhost or 127.0.0.1. Allow any
 * loopback http(s) origin in that case. Production stays on the explicit list.
 */
export function isAllowedClientOrigin(origin, clientOrigin = env.clientOrigin) {
  const normalized = stripSlash(origin);
  if (!normalized) return false;
  if (allowedClientOrigins(clientOrigin).includes(normalized)) return true;

  if (!env.isProd && configuredHasLocalOrigin(clientOrigin)) {
    try {
      const url = new URL(normalized);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      return isLoopbackHost(url.hostname);
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Express CORS origin callback. Requests without an Origin header (health
 * probes, server-to-server calls, and same-origin tooling) are not browsers
 * and therefore do not need an ACAO header. Browser origins are restricted to
 * the configured list, including the documented apex/www aliases.
 */
export function corsOriginCallback(origin, callback, clientOrigin = env.clientOrigin) {
  callback(null, !origin || isAllowedClientOrigin(origin, clientOrigin));
}
