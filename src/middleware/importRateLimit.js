import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { IMPORT_ERROR } from '../utils/importErrors.js';

/**
 * Rate-limit tabular import endpoints to reduce concurrent heap spikes on Render.
 */
export const importRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isProd ? 30 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip || 'unknown'}:${req.user?._id || 'anon'}`,
  message: {
    error: {
      message: IMPORT_ERROR.RATE_LIMIT,
      code: 'RATE_LIMIT',
    },
  },
});
