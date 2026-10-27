import { env } from './env.js';

function stripSlash(origin) {
  return String(origin || '').trim().replace(/\/$/, '');
}

function originWithHost(url, hostname) {
  const port = url.port ? `:${url.port}` : '';
  return `${url.protocol}//${hostname}${port}`;
}

/**
 * Browser origins allowed to call the API with credentials.
 * CLIENT_ORIGIN may be a single URL or a comma-separated list.
 * Also allow the www / apex twin so Prod cookies and CORS survive both hosts.
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
    } catch {
      /* ignore malformed */
    }
  }
  return [...new Set([...raw, ...extra])];
}

export function isAllowedClientOrigin(origin, clientOrigin = env.clientOrigin) {
  const normalized = stripSlash(origin);
  if (!normalized) return false;
  return allowedClientOrigins(clientOrigin).includes(normalized);
}
