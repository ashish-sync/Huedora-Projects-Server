import dotenv from 'dotenv';

dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

function requiredInProd(name, value) {
  if (isProd && !String(value || '').trim()) {
    throw new Error(`[config] ${name} is required when NODE_ENV=production`);
  }
  return value;
}

function strongSecret(name, value) {
  const v = String(value || '').trim();
  if (!isProd) {
    return v || `dev-only-${name.toLowerCase()}-not-for-production`;
  }
  if (!v || v.length < 32) {
    throw new Error(
      `[config] ${name} must be set to a strong secret (32+ characters) in production`
    );
  }
  const weakHints = ['change-me', 'dev-access', 'dev-refresh', 'dhub-dev-', 'password123'];
  if (weakHints.some((w) => v.toLowerCase().includes(w))) {
    throw new Error(`[config] ${name} looks like a placeholder — set a real secret in production`);
  }
  return v;
}

export const env = {
  port: Number(process.env.PORT || 5000),
  nodeEnv,
  isProd,
  clientOrigin: requiredInProd('CLIENT_ORIGIN', process.env.CLIENT_ORIGIN) || 'http://localhost:5173',
  useMemoryDb: String(process.env.USE_MEMORY_DB || 'false').toLowerCase() === 'true',
  /** Prefer file DB locally unless USE_MONGOOSE=true */
  useMongoose: String(process.env.USE_MONGOOSE || 'false').toLowerCase() === 'true',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dhub',
  jwtAccessSecret: strongSecret('JWT_ACCESS_SECRET', process.env.JWT_ACCESS_SECRET),
  jwtRefreshSecret: strongSecret('JWT_REFRESH_SECRET', process.env.JWT_REFRESH_SECRET),
  jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
  jwtRefreshExpiresDays: Number(process.env.JWT_REFRESH_EXPIRES_DAYS || 7),
  /** Optional first-run admin — both must be set; never defaults to a public demo password */
  bootstrapAdminEmail: String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase(),
  bootstrapAdminPassword: String(process.env.BOOTSTRAP_ADMIN_PASSWORD || ''),
  bootstrapAdminName: String(process.env.BOOTSTRAP_ADMIN_NAME || 'Administrator').trim(),
  /**
   * When true (and bootstrap email/password are set), update that admin's password on boot.
   * Use once to recover a locked/forgotten production admin, then set back to false.
   */
  bootstrapAdminReset:
    String(process.env.BOOTSTRAP_ADMIN_RESET || 'false').toLowerCase() === 'true',
  /** Dev-only: create manager@ / verifier@ demo accounts — ignored in production */
  seedDemoUsers: !isProd && String(process.env.SEED_DEMO_USERS || 'false').toLowerCase() === 'true',
  uploadMaxBytes: Number(process.env.UPLOAD_MAX_BYTES || 10485760),
  smtpEnabled: String(process.env.SMTP_ENABLED || 'false').toLowerCase() === 'true',
  seedAgreementSamples:
    !isProd && String(process.env.SEED_AGREEMENT_SAMPLES || 'false').toLowerCase() === 'true',
};
