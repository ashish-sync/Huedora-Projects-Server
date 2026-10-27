import { env } from '../../config/env.js';

const COOKIE_PATHS = ['/api/v1/auth', '/'];
const SAMESITE_VALUES = new Set(['none', 'lax', 'strict']);

function resolveSameSite(nodeEnv = env.nodeEnv) {
  const fromEnv = String(process.env.COOKIE_SAMESITE || '').trim().toLowerCase();
  if (SAMESITE_VALUES.has(fromEnv)) return fromEnv;
  // Prod SPA (tylo.systems) talks to api.tylo.systems — a different origin.
  // SameSite=Lax is not sent on those credentialed fetches, so the refresh
  // cookie never arrives and login dies when the access JWT expires.
  return nodeEnv === 'production' ? 'none' : 'lax';
}

/**
 * httpOnly refresh-token cookie.
 * Prod uses SameSite=None; Secure so tylo.systems can refresh against api.tylo.systems.
 */
export function refreshCookieOptions({ secure, sameSite, nodeEnv = env.nodeEnv } = {}) {
  const isDev = nodeEnv === 'development';
  const resolvedSameSite = sameSite || resolveSameSite(nodeEnv);
  const safeSameSite = SAMESITE_VALUES.has(resolvedSameSite) ? resolvedSameSite : 'lax';
  const resolvedSecure =
    typeof secure === 'boolean' ? secure : !isDev;
  return {
    httpOnly: true,
    // SameSite=None is rejected by browsers unless Secure is set.
    secure: safeSameSite === 'none' ? true : resolvedSecure,
    sameSite: safeSameSite,
    path: '/api/v1/auth',
  };
}

export function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    ...refreshCookieOptions(),
    maxAge: env.jwtRefreshExpiresDays * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res) {
  // Browsers only drop a cookie when clear attributes match how it was set.
  // Cover Secure / SameSite / path variants from NODE_ENV drift and the Prod Lax→None migration.
  const variants = [];
  for (const sameSite of ['lax', 'none']) {
    for (const secure of [true, false]) {
      if (sameSite === 'none' && !secure) continue;
      for (const path of COOKIE_PATHS) {
        variants.push({
          httpOnly: true,
          secure,
          sameSite,
          path,
        });
      }
    }
  }
  for (const opts of variants) {
    res.clearCookie('refreshToken', opts);
    res.cookie('refreshToken', '', { ...opts, maxAge: 0, expires: new Date(0) });
  }
}
