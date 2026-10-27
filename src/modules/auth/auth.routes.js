import { Router } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import * as authService from './auth.service.js';
import { clearRefreshCookie, setRefreshCookie } from './auth.cookies.js';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler, AppError } from '../../utils/helpers.js';
import { env } from '../../config/env.js';
import { isAllowedClientOrigin } from '../../config/corsOrigins.js';
import { User } from '../users/user.model.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Only failed attempts count; successful logins do not burn the budget.
  max: env.isProd ? 20 : 60,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  // Key by IP + email so one address/email pair cannot lock out the whole site
  // when many clients share a proxy egress IP.
  keyGenerator: (req) => {
    const email = String(req.body?.email || '')
      .toLowerCase()
      .trim()
      .slice(0, 120);
    return `${req.ip || 'unknown'}:${email || 'none'}`;
  },
  message: { error: { message: 'Too many login attempts. Try again later.', code: 'RATE_LIMIT' } },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isProd ? 120 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
  message: { error: { message: 'Too many refresh attempts. Try again later.', code: 'RATE_LIMIT' } },
});

const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isProd ? 10 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip || 'unknown'}:${req.user?._id || 'anon'}`,
  message: { error: { message: 'Too many password change attempts. Try again later.', code: 'RATE_LIMIT' } },
});

function assertTrustedOrigin(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return;
  if (!isAllowedClientOrigin(origin)) {
    throw new AppError('Forbidden origin', 403, 'FORBIDDEN');
  }
}

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    assertTrustedOrigin(req);
    const result = await authService.login({
      email: req.body.email,
      password: req.body.password,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });
    setRefreshCookie(res, result.refreshToken);
    res.json({
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    });
  })
);

router.post(
  '/refresh',
  refreshLimiter,
  asyncHandler(async (req, res) => {
    assertTrustedOrigin(req);
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
    try {
      const result = await authService.refresh({
        refreshToken,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId,
      });
      setRefreshCookie(res, result.refreshToken);
      res.json({ data: { accessToken: result.accessToken, user: result.user } });
    } catch (err) {
      // Drop stale/revoked cookies so a page reload cannot keep retrying them.
      clearRefreshCookie(res);
      throw err;
    }
  })
);

async function resolveLogoutActor(req) {
  if (req.user) return req.user;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.jwtAccessSecret);
    if (!payload?.sub) return null;
    // Accept even when tokenVersion already drifted — we only need the user id to revoke.
    return await User.findOne({ _id: payload.sub, isDeleted: false });
  } catch {
    // Expired access tokens are still useful for identifying whom to revoke.
    try {
      const payload = jwt.verify(token, env.jwtAccessSecret, { ignoreExpiration: true });
      if (!payload?.sub) return null;
      return await User.findOne({ _id: payload.sub, isDeleted: false });
    } catch {
      return null;
    }
  }
}

router.post(
  '/logout',
  // Do not require Bearer auth — the client clears the access token before calling
  // logout for a snappy UI. Prefer refresh cookie; fall back to optional Bearer.
  asyncHandler(async (req, res) => {
    assertTrustedOrigin(req);
    const user = await resolveLogoutActor(req);
    await authService.logout({
      refreshToken: req.cookies.refreshToken || req.body?.refreshToken,
      user,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });
    clearRefreshCookie(res);
    res.json({ data: { ok: true } });
  })
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ _id: req.user._id, isDeleted: false })
      .populate('roleIds')
      .populate('reportingManagerId', 'fullName email designation');
    res.json({ data: authService.publicUser(user || req.user) });
  })
);

router.post(
  '/change-password',
  authenticate,
  passwordChangeLimiter,
  asyncHandler(async (req, res) => {
    await authService.changePassword({
      user: req.user,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
      requestId: req.requestId,
      ip: req.ip,
    });
    res.json({ data: { ok: true } });
  })
);

router.post(
  '/reset-password',
  loginLimiter,
  asyncHandler(async (req, res) => {
    await authService.resetPasswordWithCurrent({
      email: req.body.email,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.json({ data: { ok: true } });
  })
);

export default router;
