import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as authService from './auth.service.js';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/helpers.js';
import { env } from '../../config/env.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: env.jwtRefreshExpiresDays * 24 * 60 * 60 * 1000,
    path: '/api/v1/auth',
  });
}

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
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
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
    const result = await authService.refresh({
      refreshToken,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });
    setRefreshCookie(res, result.refreshToken);
    res.json({ data: { accessToken: result.accessToken, user: result.user } });
  })
);

router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    await authService.logout({
      refreshToken: req.cookies.refreshToken,
      user: req.user,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    res.json({ data: { ok: true } });
  })
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ data: authService.publicUser(req.user) });
  })
);

router.post(
  '/change-password',
  authenticate,
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

export default router;
