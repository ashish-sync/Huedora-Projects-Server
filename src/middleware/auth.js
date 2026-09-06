import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../modules/users/user.model.js';
import { AppError } from '../utils/helpers.js';
import { PERMISSIONS } from '../config/constants.js';
import { collectUserPermissions } from '../modules/users/userAccess.js';

const AUTH_CACHE_TTL_MS = Number(process.env.AUTH_CACHE_TTL_MS) || 30_000;
/** @type {Map<string, { expires: number, user: object, permissions: Set<string>, tokenVersion: number }>} */
const authCache = new Map();

export function invalidateAuthCache(userId) {
  if (!userId) {
    authCache.clear();
    return;
  }
  authCache.delete(String(userId));
}

export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError('Authentication required', 401, 'UNAUTHORIZED');

    let payload;
    try {
      payload = jwt.verify(token, env.jwtAccessSecret);
    } catch {
      throw new AppError('Invalid or expired token', 401, 'UNAUTHORIZED');
    }

    const cacheKey = String(payload.sub || '');
    const cached = cacheKey ? authCache.get(cacheKey) : null;
    if (
      cached
      && cached.expires > Date.now()
      && (payload.tv === undefined || payload.tv === cached.tokenVersion)
    ) {
      req.user = cached.user;
      req.permissions = cached.permissions;
      return next();
    }

    const user = await User.findOne({ _id: payload.sub, isDeleted: false, isActive: true }).populate(
      'roleIds',
    );
    if (!user) throw new AppError('User not found or inactive', 401, 'UNAUTHORIZED');
    if (payload.tv !== undefined && payload.tv !== user.tokenVersion) {
      throw new AppError('Session invalidated', 401, 'UNAUTHORIZED');
    }

    const permissions = collectUserPermissions(user);
    if (cacheKey) {
      authCache.set(cacheKey, {
        expires: Date.now() + AUTH_CACHE_TTL_MS,
        user,
        permissions,
        tokenVersion: user.tokenVersion,
      });
    }

    req.user = user;
    req.permissions = permissions;
    next();
  } catch (err) {
    next(err);
  }
}

export function requirePermission(...needed) {
  return (req, _res, next) => {
    if (!req.permissions) return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    if (req.permissions.has(PERMISSIONS.ALL)) return next();
    const ok = needed.some((p) => req.permissions.has(p));
    if (!ok) return next(new AppError('Forbidden', 403, 'FORBIDDEN'));
    next();
  };
}

export function hasPermission(req, permission) {
  return req.permissions?.has(PERMISSIONS.ALL) || req.permissions?.has(permission);
}

export function collectPermissions(user) {
  return collectUserPermissions(user);
}

export function userHasAnyPermission(user, ...needed) {
  const perms = collectPermissions(user);
  if (perms.has(PERMISSIONS.ALL)) return true;
  return needed.some((p) => perms.has(p));
}

/** Only users with the Admin role (permission `*`) may delete records. */
export const requireAdmin = requirePermission(PERMISSIONS.ALL);
