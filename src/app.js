import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
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
import repairRoutes from './modules/repairs/repair.routes.js';
import documentRoutes from './modules/documents/document.routes.js';
import notificationRoutes from './modules/notifications/notification.routes.js';
import dashboardRoutes from './modules/dashboards/dashboard.routes.js';
import auditRoutes from './modules/audit/audit.routes.js';
import importRoutes from './modules/imports/import.routes.js';
import campRoutes from './modules/camps/camp.routes.js';
import assetRequestRoutes from './modules/assetRequests/assetRequest.routes.js';
import logisticsRoutes from './modules/logistics/logistics.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.resolve(__dirname, '../uploads');

export function createApp() {
  const app = express();

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: env.clientOrigin,
      credentials: true,
    })
  );
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(correlationId);
  app.use('/uploads', express.static(uploadsRoot));

  app.get('/api/v1/health', (_req, res) => {
    res.json({
      data: {
        status: 'ok',
        live: true,
        service: 'dhub-api',
        ts: new Date().toISOString(),
      },
    });
  });

  /** Liveness probe — same payload as /health for load balancers / frontend boot gate */
  app.get('/api/v1/live', (_req, res) => {
    res.status(200).json({
      data: {
        status: 'ok',
        live: true,
        service: 'dhub-api',
        ts: new Date().toISOString(),
      },
    });
  });

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
  app.use('/api/v1/dashboards', dashboardRoutes);
  app.use('/api/v1/audit-logs', auditRoutes);
  app.use('/api/v1/imports', importRoutes);
  app.use('/api/v1/camps', campRoutes);
  app.use('/api/v1/asset-requests', assetRequestRoutes);
  app.use('/api/v1/logistics', logisticsRoutes);
  // Mount last: this router applies auth to its own paths under /api/v1 (e.g. /repairs)
  app.use('/api/v1', repairRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
