import { createApp } from './app.js';
import { connectDb, getDbInfo } from './config/db.js';
import { env } from './config/env.js';
import { ensureSeed } from './seed.js';
import { forceReseedGeoMasters } from './modules/geo/geo.seed.js';
import { resetApplicationData } from './utils/resetApplicationData.js';
import { hydrateEmailIngestState } from './modules/campOps/communications/services/emailIngestSince.js';
import { ensureUploadDirs } from './config/paths.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const freshStartTrigger = path.resolve(__dirname, '../.fresh-start');

async function maybeFreshStart() {
  const fromEnv = String(process.env.RESET_ALL_DATA_ON_BOOT || '').toLowerCase() === 'true';
  const fromMarker = fs.existsSync(freshStartTrigger);
  if (!fromEnv && !fromMarker) return;

  await resetApplicationData();
  if (fromMarker) {
    fs.unlinkSync(freshStartTrigger);
    console.warn('[reset] Fresh-start marker consumed (.fresh-start removed)');
  }
  if (fromEnv) {
    console.warn('[reset] RESET_ALL_DATA_ON_BOOT=true — set it back to false after this deploy');
  }
}

async function maybeReseedGeoOnBoot() {
  if (String(process.env.RESEED_GEO_ON_BOOT || '').toLowerCase() !== 'true') return;
  const result = await forceReseedGeoMasters();
  console.warn('[geo] RESEED_GEO_ON_BOOT=true — masters reloaded:', result.counts);
  console.warn('[geo] Set RESEED_GEO_ON_BOOT=false after this deploy');
}

async function main() {
  if (env.isProd) {
    if (String(process.env.RESET_ALL_DATA_ON_BOOT || '').toLowerCase() === 'true') {
      throw new Error('[config] RESET_ALL_DATA_ON_BOOT is not allowed in production');
    }
    if (env.bootstrapAdminReset) {
      throw new Error('[config] BOOTSTRAP_ADMIN_RESET is not allowed in production');
    }
  }
  await connectDb();
  const db = getDbInfo();
  console.log(`[api] Persistence: ${db.mode}${db.useMongoose ? ' (MongoDB)' : ' (local JSON — not for production)'}`);
  ensureUploadDirs();
  await hydrateEmailIngestState();
  await maybeFreshStart();
  await ensureSeed();
  await maybeReseedGeoOnBoot();
  const app = createApp();
  app.listen(env.port, () => {
    console.log(`[api] TYLO One listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start API', err);
  process.exit(1);
});
