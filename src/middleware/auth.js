import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../modules/users/user.model.js';
import { AppError } from '../utils/helpers.js';
import { PERMISSIONS } from '../config/constants.js';

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

    const user = await User.findOne({ _id: payload.sub, isDeleted: false, isActive: true }).populate(
      'roleIds'
    );
    if (!user) throw new AppError('User not found or inactive', 401, 'UNAUTHORIZED');
    if (payload.tv !== undefined && payload.tv !== user.tokenVersion) {
      throw new AppError('Session invalidated', 401, 'UNAUTHORIZED');
    }

    const permissions = new Set();
    for (const role of user.roleIds || []) {
      for (const p of role.permissions || []) permissions.add(p);
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
