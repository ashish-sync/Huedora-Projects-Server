import { createApp } from './app.js';
import { connectDb, getDbInfo } from './config/db.js';
import { env } from './config/env.js';
import { ensureSeed } from './seed.js';
import { forceReseedGeoMasters } from './modules/geo/geo.seed.js';
import { healOrphanPinDistrictLinks } from './modules/geo/pinCodeHeal.js';
import { resetApplicationData } from './utils/resetApplicationData.js';
import { freshStartKeepUsers } from './utils/freshStartKeepUsers.js';
import { hydrateEmailIngestState } from './modules/campOps/communications/services/emailIngestSince.js';
import { ensureUploadDirs } from './config/paths.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const freshStartTrigger = path.resolve(__dirname, '../.fresh-start');

async function maybeFreshStart() {
  const keepUsersBoot =
    String(process.env.FRESH_START_KEEP_USERS_ON_BOOT || '').toLowerCase() === 'true';
  if (keepUsersBoot) {
    await freshStartKeepUsers();
    console.warn(
      '[fresh-start] FRESH_START_KEEP_USERS_ON_BOOT=true — set it back to false after this deploy',
    );
    return;
  }

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

/** One-shot soft-delete of every Camp One camp (all stages). Safe for production. */
async function maybePurgeAllCampsOnBoot() {
  if (String(process.env.PURGE_ALL_CAMPS_ON_BOOT || '').toLowerCase() !== 'true') return;
  const { purgeAllCamps } = await import('./utils/purgeAllCamps.js');
  const result = await purgeAllCamps({ actorId: 'boot:PURGE_ALL_CAMPS_ON_BOOT' });
  console.warn('[camps] PURGE_ALL_CAMPS_ON_BOOT=true — soft-deleted camps:', result);
  console.warn('[camps] Set PURGE_ALL_CAMPS_ON_BOOT=false after this deploy');
}

/**
 * One-shot permanent delete of Camp One camps by Division/Therapy (campaignType).
 * Exact match only (trim + case fold) — e.g. MOM matches "MOM"/" mom " but not "MOM Camp".
 * Example: PURGE_CAMPS_BY_CAMPAIGN_TYPE_ON_BOOT=MOM
 * Dry-run: PURGE_CAMPS_BY_CAMPAIGN_TYPE_ON_BOOT_DRY_RUN=true
 */
async function maybeHardDeleteCampsByCampaignTypeOnBoot() {
  const { maybeHardDeleteCampsByCampaignTypeOnBoot } = await import(
    './utils/hardDeleteCampsByCampaignTypeOnBoot.js'
  );
  await maybeHardDeleteCampsByCampaignTypeOnBoot();
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
  await maybePurgeAllCampsOnBoot();
  await maybeHardDeleteCampsByCampaignTypeOnBoot();
  await ensureSeed();
  try {
    const { ensureTeamUsersInDatabase } = await import('./boot/ensureTeamUsers.js');
    await ensureTeamUsersInDatabase();
  } catch (err) {
    console.error('[team-users] Boot import failed:', err.message);
  }
  await maybeReseedGeoOnBoot();
  try {
    const pinHeal = await healOrphanPinDistrictLinks();
    if (pinHeal.healed) {
      console.warn(`[geo] Healed ${pinHeal.healed} PIN row(s) with orphan district links`);
    }
  } catch (err) {
    console.error('[geo] PIN orphan heal failed:', err.message);
  }
  const app = createApp();
  app.listen(env.port, () => {
    console.log(`[api] TYLO One listening on http://localhost:${env.port}`);
    const m = process.memoryUsage();
    console.warn(
      `[memory] boot rss=${(m.rss / 1024 / 1024).toFixed(1)}MB heap=${(m.heapUsed / 1024 / 1024).toFixed(1)}MB`
    );
    import('./utils/memory.js')
      .then(({ startMemoryWatch }) => startMemoryWatch({ intervalMs: 180_000, rssWarnMb: 400 }))
      .catch(() => {});
    import('./modules/imports/streaming/tempUpload.js')
      .then(({ cleanupStaleImportTemps }) => {
        cleanupStaleImportTemps();
        const t = setInterval(() => cleanupStaleImportTemps(), 30 * 60 * 1000);
        if (typeof t.unref === 'function') t.unref();
      })
      .catch(() => {});
    import('./modules/finance/purgeStaleCommercialDrafts.js')
      .then(({ purgeStaleCommercialDrafts }) => {
        const run = () =>
          purgeStaleCommercialDrafts()
            .then((r) => {
              if (r.warned || r.deleted) {
                console.warn(
                  `[finance] stale draft purge: scanned=${r.scanned} warned=${r.warned} deleted=${r.deleted}`,
                );
              }
            })
            .catch((err) => console.error('[finance] stale draft purge failed:', err.message));
        run();
        // Every 6 hours — drafts are purged after 30 days idle; warn ~2 days prior.
        const t = setInterval(run, 6 * 60 * 60 * 1000);
        if (typeof t.unref === 'function') t.unref();
      })
      .catch(() => {});
    import('./modules/retention/ninetyDayArchive.js')
      .then(({ runNinetyDayArchive }) => {
        const run = () =>
          runNinetyDayArchive()
            .then((r) => {
              if (r.warned || r.archived) {
                console.warn(
                  `[retention] 90-day archive: scanned=${r.scanned} warned=${r.warned} archived=${r.archived}`,
                );
              }
            })
            .catch((err) => console.error('[retention] 90-day archive failed:', err.message));
        run();
        const t = setInterval(run, 6 * 60 * 60 * 1000);
        if (typeof t.unref === 'function') t.unref();
      })
      .catch(() => {});
  });
}

main().catch((err) => {
  console.error('Failed to start API', err);
  process.exit(1);
});
