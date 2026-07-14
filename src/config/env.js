import dotenv from 'dotenv';

dotenv.config();

export const env = {
  port: Number(process.env.PORT || 5000),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  useMemoryDb: String(process.env.USE_MEMORY_DB || 'true').toLowerCase() === 'true',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dhub',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh',
  jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
  jwtRefreshExpiresDays: Number(process.env.JWT_REFRESH_EXPIRES_DAYS || 7),
  bootstrapAdminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@dhub.local',
  bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'Admin@12345',
  bootstrapAdminName: process.env.BOOTSTRAP_ADMIN_NAME || 'DHub Administrator',
  uploadMaxBytes: Number(process.env.UPLOAD_MAX_BYTES || 10485760),
  smtpEnabled: String(process.env.SMTP_ENABLED || 'false').toLowerCase() === 'true',
  seedAgreementSamples: String(process.env.SEED_AGREEMENT_SAMPLES || 'true').toLowerCase() === 'true',
};
