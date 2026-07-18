import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { User } from '../users/user.model.js';
import { RefreshToken } from './refreshToken.model.js';
import { AppError } from '../../utils/helpers.js';
import { writeAudit } from '../../utils/audit.js';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function signAccess(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email, tv: user.tokenVersion },
    env.jwtAccessSecret,
    { expiresIn: env.jwtAccessExpires }
  );
}

function signRefresh(user) {
  return jwt.sign(
    { sub: user._id.toString(), tv: user.tokenVersion, typ: 'refresh' },
    env.jwtRefreshSecret,
    { expiresIn: `${env.jwtRefreshExpiresDays}d` }
  );
}

export function collectPermissions(user) {
  const set = new Set();
  for (const role of user.roleIds || []) {
    for (const p of role.permissions || []) set.add(p);
  }
  return [...set];
}

export function publicUser(user) {
  return {
    id: user._id,
    email: user.email,
    username: user.username,
    fullName: user.fullName,
    phone: user.phone,
    isActive: user.isActive !== false,
    roles: (user.roleIds || []).map((r) => ({
      id: r?._id || r,
      name: r?.name || '',
    })),
    permissions: collectPermissions(user),
    lastLoginAt: user.lastLoginAt,
    passwordChangedAt: user.passwordChangedAt || null,
  };
}

/** Normalize login email; map legacy @dhub.local to @tylo.local after rebrand. */
function normalizeLoginEmail(email) {
  let value = String(email || '').toLowerCase().trim();
  if (value.endsWith('@dhub.local')) {
    value = `${value.slice(0, -'@dhub.local'.length)}@tylo.local`;
  }
  return value;
}

export async function login({ email, password, ip, userAgent, requestId }) {
  const normalizedEmail = normalizeLoginEmail(email);
  const user = await User.findOne({
    email: normalizedEmail,
    isDeleted: false,
  }).populate('roleIds');

  if (!user || !user.isActive) {
    await writeAudit({
      actorType: 'USER',
      actorEmail: email,
      action: 'USER.LOGIN_FAILURE',
      ip,
      userAgent,
      requestId,
      result: 'FAILURE',
      message: 'Invalid credentials or inactive',
    });
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  if (user.lockUntil && user.lockUntil > new Date()) {
    throw new AppError('Account locked. Try again later.', 423, 'ACCOUNT_LOCKED');
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= 5) {
      user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
      user.failedLoginAttempts = 0;
    }
    await user.save();
    await writeAudit({
      actorId: user._id,
      actorEmail: user.email,
      action: 'USER.LOGIN_FAILURE',
      ip,
      userAgent,
      requestId,
      result: 'FAILURE',
    });
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  const accessToken = signAccess(user);
  const refreshToken = signRefresh(user);
  const expiresAt = new Date(Date.now() + env.jwtRefreshExpiresDays * 24 * 60 * 60 * 1000);
  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt,
    userAgent,
    ip,
  });

  await writeAudit({
    actorId: user._id,
    actorEmail: user.email,
    action: 'USER.LOGIN_SUCCESS',
    ip,
    userAgent,
    requestId,
  });

  return { accessToken, refreshToken, user: publicUser(user) };
}

export async function refresh({ refreshToken, ip, userAgent, requestId }) {
  if (!refreshToken) throw new AppError('Refresh token required', 401, 'UNAUTHORIZED');

  let payload;
  try {
    payload = jwt.verify(refreshToken, env.jwtRefreshSecret);
  } catch {
    throw new AppError('Invalid refresh token', 401, 'UNAUTHORIZED');
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await RefreshToken.findOne({ tokenHash, revokedAt: null });
  if (!stored || stored.expiresAt < new Date()) {
    throw new AppError('Refresh token revoked or expired', 401, 'UNAUTHORIZED');
  }

  const user = await User.findOne({ _id: payload.sub, isDeleted: false, isActive: true }).populate(
    'roleIds'
  );
  if (!user || payload.tv !== user.tokenVersion) {
    throw new AppError('Session invalidated', 401, 'UNAUTHORIZED');
  }

  stored.revokedAt = new Date();
  const newRefresh = signRefresh(user);
  stored.replacedByTokenHash = hashToken(newRefresh);
  await stored.save();

  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(newRefresh),
    expiresAt: new Date(Date.now() + env.jwtRefreshExpiresDays * 24 * 60 * 60 * 1000),
    userAgent,
    ip,
  });

  await writeAudit({
    actorId: user._id,
    actorEmail: user.email,
    action: 'USER.TOKEN_REFRESH',
    ip,
    userAgent,
    requestId,
  });

  return { accessToken: signAccess(user), refreshToken: newRefresh, user: publicUser(user) };
}

export async function logout({ refreshToken, user, ip, userAgent, requestId }) {
  if (refreshToken) {
    const tokenHash = hashToken(refreshToken);
    await RefreshToken.updateOne({ tokenHash }, { $set: { revokedAt: new Date() } });
  }
  await writeAudit({
    actorId: user?._id,
    actorEmail: user?.email,
    action: 'USER.LOGOUT',
    ip,
    userAgent,
    requestId,
  });
}

export async function changePassword({ user, currentPassword, newPassword, requestId, ip }) {
  const fresh = await User.findById(user._id);
  const ok = await bcrypt.compare(currentPassword, fresh.passwordHash);
  if (!ok) throw new AppError('Current password is incorrect', 400, 'VALIDATION_ERROR');
  if (!newPassword || newPassword.length < 12) {
    throw new AppError('Password must be at least 12 characters', 400, 'VALIDATION_ERROR');
  }
  fresh.passwordHash = await bcrypt.hash(newPassword, 12);
  fresh.passwordChangedAt = new Date();
  fresh.tokenVersion += 1;
  await fresh.save();
  await RefreshToken.updateMany({ userId: fresh._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await writeAudit({
    actorId: fresh._id,
    actorEmail: fresh.email,
    action: 'USER.PASSWORD_CHANGE',
    ip,
    requestId,
  });
}
