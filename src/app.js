import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { checkPersistenceReady as defaultCheckPersistenceReady } from './config/db.js';
import { correlationId, errorHandler, notFound } from './middleware/error.js';

import authRoutes from './modules/auth/auth.routes.js';
import userRoutes from './modules/users/user.routes.js';
import hcwRoutes from './modules/hcws/hcw.routes.js';
import deviceRoutes from './modules/devices/device.routes.js';
import assetRoutes from './modules/assets/asset.routes.js';
import agreementRoutes from './modules/agreements/agreement.routes.js';
import contactRoutes from './modules/contacts/contact.routes.js';
import templateRoutes from './modules/templates/template.routes.js';
import signatureRoutes from './modules/signatures/signature.routes.js';
import recipientRoutes from './modules/agreements/recipient.routes.js';
import verificationRoutes from './modules/verifications/verification.routes.js';
import selfVerifyRoutes from './modules/verifications/selfVerify.routes.js';
import movementRoutes from './modules/movements/movement.routes.js';
import { repairRoutes, maintenanceRoutes } from './modules/repairs/repair.routes.js';
import documentRoutes from './modules/documents/document.routes.js';
import notificationRoutes from './modules/notifications/notification.routes.js';
import entityWatchRoutes from './modules/notifications/entityWatch.routes.js';
import dashboardRoutes from './modules/dashboards/dashboard.routes.js';
import auditRoutes from './modules/audit/audit.routes.js';
import importRoutes from './modules/imports/import.routes.js';
import campRoutes from './modules/camps/camp.routes.js';
import campOpsRoutes from './modules/campOps/campOps.routes.js';
import campOpsWhatsappRoutes from './modules/campOps/campOps.whatsapp.routes.js';
import assetRequestRoutes from './modules/assetRequests/assetRequest.routes.js';
import requestUploadRoutes from './modules/assetRequests/requestUpload.routes.js';
import logisticsRoutes from './modules/logistics/logistics.routes.js';
import financeRoutes from './modules/finance/finance.routes.js';
import geoRoutes from './modules/geo/geo.routes.js';
import picklistRoutes from './modules/picklists/picklist.routes.js';
import fileRoutes from './modules/files/file.routes.js';
import retentionRoutes from './modules/retention/retention.routes.js';

export function createApp(options = {}) {
  const checkReady = options.checkReady || defaultCheckPersistenceReady;
  const app = express();

  // Render / Cloudflare sit behind a reverse proxy. needed for correct client IPs
  // (login rate limiting, audit logs). Without this, many users share one proxy IP.
  if (env.isProd) {
    app.set('trust proxy', 1);
  }

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: env.clientOrigin,
      credentials: true,
    })
  );
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
  app.use(express.json({ limit: '2mb' }));
  // Larger JSON bodies only needed for camp paste/mapping — those routes accept
  // multipart file uploads for bulk data; keep default JSON small for heap safety.
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(correlationId);
  // Request product images are only available through authenticated request routes.
  app.use('/uploads/asset-requests', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
  });
  // Never expose a public static tree. Stored DB paths remain `/uploads/...`;
  // API responses convert them to short-lived signed `/api/v1/files/signed` URLs.
  // Direct `/uploads/*` access must not mint tokens (that would bypass auth).
  app.use('/uploads', (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Direct upload URLs are disabled. Use a signed file link from the API.',
      },
    });
  });

  /** Liveness: process is up. Do not check Mongo here (use /ready). */
  app.get('/api/v1/health', (_req, res) => {
    const payload = {
      status: 'ok',
      live: true,
      service: 'tylo-one-api',
      ts: new Date().toISOString(),
    };
    if (String(process.env.MEMORY_LOG || '').toLowerCase() === 'true') {
      const m = process.memoryUsage();
      payload.memory = {
        rssMb: +(m.rss / 1024 / 1024).toFixed(1),
        heapUsedMb: +(m.heapUsed / 1024 / 1024).toFixed(1),
      };
    }
    res.status(200).json({ data: payload });
  });

  /** Liveness probe alias for load balancers / frontend boot gate */
  app.get('/api/v1/live', (_req, res) => {
    res.status(200).json({
      data: {
        status: 'ok',
        live: true,
        service: 'tylo-one-api',
        ts: new Date().toISOString(),
      },
    });
  });

  /** Readiness: MongoDB connectivity (prod) or writable file store (dev). */
  app.get('/api/v1/ready', async (_req, res) => {
    const check = await checkReady();
    if (!check.ready) {
      return res.status(503).json({
        data: {
          status: 'not_ready',
          ready: false,
          reason: check.reason,
          persistence: check.persistence,
          ts: new Date().toISOString(),
        },
      });
    }
    res.status(200).json({
      data: {
        status: 'ok',
        ready: true,
        persistence: check.persistence,
        mongoHost: check.mongoHost || undefined,
        ts: new Date().toISOString(),
      },
    });
  });

  /** Public runtime config for the SPA (no secrets beyond referrer-restricted Maps keys). */
  app.get('/api/v1/config/public', (_req, res) => {
    res.json({
      data: {
        googleMapsApiKey: env.googleMapsApiKey || null,
      },
    });
  });

  // Public, token-gated custodian upload flow. Keep before the /api/v1 catch-all router.
  app.use('/api/v1/request-upload', requestUploadRoutes);
  app.use('/api/v1/ingest/whatsapp', campOpsWhatsappRoutes);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/hcws', hcwRoutes);
  app.use('/api/v1/devices', deviceRoutes);
  app.use('/api/v1/assets', assetRoutes);
  app.use('/api/v1/agreements', agreementRoutes);
  app.use('/api/v1/recipient', recipientRoutes);
  app.use('/api/v1/contacts', contactRoutes);
  app.use('/api/v1/templates', templateRoutes);
  app.use('/api/v1/signatures', signatureRoutes);
  app.use('/api/v1/verifications', verificationRoutes);
  app.use('/api/v1/self-verify', selfVerifyRoutes);
  app.use('/api/v1/movements', movementRoutes);
  app.use('/api/v1/documents', documentRoutes);
  app.use('/api/v1/notifications', notificationRoutes);
  app.use('/api/v1/entity-watches', entityWatchRoutes);
  app.use('/api/v1/dashboards', dashboardRoutes);
  app.use('/api/v1/audit-logs', auditRoutes);
  app.use('/api/v1/imports', importRoutes);
  app.use('/api/v1/camps', campRoutes);
  app.use('/api/v1/camp-ops', campOpsRoutes);
  app.use('/api/v1/asset-requests', assetRequestRoutes);
  app.use('/api/v1/logistics', logisticsRoutes);
  app.use('/api/v1/finance', financeRoutes);
  app.use('/api/v1/geo', geoRoutes);
  app.use('/api/v1/picklists', picklistRoutes);
  app.use('/api/v1/files', fileRoutes);
  app.use('/api/v1/retention', retentionRoutes);
  // Scoped mounts only. never mount repairs as a /api/v1 catch-all (it hid missing routes).
  app.use('/api/v1/repairs', repairRoutes);
  app.use('/api/v1/maintenance', maintenanceRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
