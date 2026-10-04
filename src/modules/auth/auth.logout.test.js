import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { User } from '../users/user.model.js';
import { RefreshToken } from './refreshToken.model.js';
import * as authService from './auth.service.js';

function tokenHashOf(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createUser(suffix, tokenVersion = 0) {
  const email = `logout-${suffix}-${Date.now()}@tylo.local`;
  return User.create({
    email,
    username: email,
    fullName: `Logout ${suffix}`,
    passwordHash: 'x',
    isActive: true,
    tokenVersion,
    roleIds: [],
  });
}

async function createRefresh(user, tokenVersion) {
  const refreshToken = jwt.sign(
    { sub: user._id.toString(), tv: tokenVersion, typ: 'refresh' },
    env.jwtRefreshSecret,
    { expiresIn: '1d' },
  );
  const tokenHash = tokenHashOf(refreshToken);
  await RefreshToken.create({
    userId: user._id,
    tokenHash,
    expiresAt: new Date(Date.now() + 86400000),
  });
  return { refreshToken, tokenHash };
}

async function cleanup(user) {
  if (!user?._id) return;
  await RefreshToken.deleteMany({ userId: user._id });
  await User.deleteOne({ _id: user._id });
}

test('logout with refresh token revokes sessions and bumps tokenVersion', async () => {
  const user = await createUser('rt', 3);
  const { refreshToken, tokenHash } = await createRefresh(user, 3);

  try {
    await authService.logout({
      refreshToken,
      user: null,
      ip: '127.0.0.1',
      userAgent: 'test',
      requestId: 't1',
    });

    const stored = await RefreshToken.findOne({ tokenHash });
    assert.ok(stored?.revokedAt, 'refresh token should be revoked');

    const fresh = await User.findById(user._id);
    assert.equal(fresh.tokenVersion, 4);
  } finally {
    await cleanup(user);
  }
});

test('logout with bearer user only still revokes all refresh tokens', async () => {
  const user = await createUser('bearer', 1);
  const { tokenHash } = await createRefresh(user, 1);

  try {
    await authService.logout({
      refreshToken: null,
      user,
      ip: '127.0.0.1',
      userAgent: 'test',
      requestId: 't2',
    });

    const stored = await RefreshToken.findOne({ tokenHash });
    assert.ok(stored?.revokedAt, 'refresh token should be revoked via bearer actor');

    const fresh = await User.findById(user._id);
    assert.equal(fresh.tokenVersion, 2);
  } finally {
    await cleanup(user);
  }
});

test('refresh rejects revoked token after logout', async () => {
  const user = await createUser('refresh', 0);
  const { refreshToken } = await createRefresh(user, 0);

  try {
    await authService.logout({
      refreshToken,
      user,
      ip: '127.0.0.1',
      userAgent: 'test',
      requestId: 't3',
    });

    await assert.rejects(
      () => authService.refresh({
        refreshToken,
        ip: '127.0.0.1',
        userAgent: 'test',
        requestId: 't3b',
      }),
      (err) => err?.status === 401 || err?.code === 'UNAUTHORIZED' || /invalid|session/i.test(err?.message || ''),
    );
  } finally {
    await cleanup(user);
  }
});
