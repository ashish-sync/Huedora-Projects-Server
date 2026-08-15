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
  const campaignPurge = String(process.env.PURGE_CAMPS_BY_CAMPAIGN_TYPE_ON_BOOT || '').trim();
  if (campaignPurge && campaignPurge.toLowerCase() !== 'false') {
    console.warn(
      '[camps] PURGE_ALL_CAMPS_ON_BOOT skipped — PURGE_CAMPS_BY_CAMPAIGN_TYPE_ON_BOOT is also set',
    );
    return;
  }
  const { purgeAllCamps } = await import('./utils/purgeAllCamps.js');
  const result = await purgeAllCamps({ actorId: 'boot:PURGE_ALL_CAMPS_ON_BOOT' });
  console.warn('[camps] PURGE_ALL_CAMPS_ON_BOOT=true — soft-deleted camps:', result);
  console.warn('[camps] Set PURGE_ALL_CAMPS_ON_BOOT=false after this deploy');
}

/**
 * Legacy soft-delete boot purge by Division/Therapy (campaignType).
 * Not invoked from main() — production MOM cleanup uses hard delete via
 * maybeHardDeleteCampsByCampaignTypeOnBoot() and PURGE_CAMPS_BY_CAMPAIGN_TYPE_ON_BOOT.
 */
async function maybePurgeCampsByCampaignTypeOnBoot() {
  const raw = String(process.env.PURGE_CAMPS_BY_CAMPAIGN_TYPE_ON_BOOT || '').trim();
  if (!raw || raw.toLowerCase() === 'false') return;
  const {
    parseCampaignTypesEnv,
    purgeCampsByCampaignTypes,
  } = await import('./utils/purgeAllCamps.js');
  const campaignTypes = parseCampaignTypesEnv(raw);
  if (!campaignTypes.length) return;
  const result = await purgeCampsByCampaignTypes(campaignTypes, {
    actorId: 'boot:PURGE_CAMPS_BY_CAMPAIGN_TYPE_ON_BOOT',
  });
  console.warn(
    `[camps] PURGE_CAMPS_BY_CAMPAIGN_TYPE_ON_BOOT=${campaignTypes.join(',')} — soft-deleted:`,
    result,
  );
  console.warn('[camps] Clear PURGE_CAMPS_BY_CAMPAIGN_TYPE_ON_BOOT after this deploy');
}

/** One-shot soft-delete of duplicate Asset One rows that share a serial number.
 * Runs once automatically after deploy (completion lock), unless disabled.
 * Force again: DEDUPE_ASSET_SERIALS_ON_BOOT=true
 * Disable: DEDUPE_ASSET_SERIALS_ON_BOOT=false
 * Preview: DEDUPE_ASSET_SERIALS_ON_BOOT_DRY_RUN=true
 */
async function maybeDedupeAssetSerialsOnBoot() {
  const flag = String(process.env.DEDUPE_ASSET_SERIALS_ON_BOOT || 'auto').trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off') return;

  const dryRun = String(process.env.DEDUPE_ASSET_SERIALS_ON_BOOT_DRY_RUN || '').toLowerCase() === 'true';
  const force = flag === 'true';
  const lockId = 'dedupe_asset_serials:v1';

  const { loadCollection, upsertDocument } = await import('./store/persistence.js');
  const locks = await loadCollection('system_boot_locks');
  const existing = locks.find((row) => String(row._id) === lockId) || null;
  if (!force && !dryRun && existing?.status === 'completed') {
    return;
  }

  if (!dryRun) {
    await upsertDocument('system_boot_locks', {
      _id: lockId,
      ...(existing || {}),
      job: 'dedupe_asset_serials',
      status: 'running',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  try {
    const { dedupeAssetsBySerialNumber } = await import('./utils/dedupeAssetsBySerial.js');
    const result = await dedupeAssetsBySerialNumber({
      actorId: 'boot:DEDUPE_ASSET_SERIALS_ON_BOOT',
      dryRun,
    });
    console.warn(
      `[assets] serial dedupe ${dryRun ? 'dry-run' : 'complete'}:`,
      result,
    );

    if (!dryRun) {
      await upsertDocument('system_boot_locks', {
        _id: lockId,
        job: 'dedupe_asset_serials',
        status: 'completed',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...result,
      });
      if (force) {
        console.warn('[assets] Clear DEDUPE_ASSET_SERIALS_ON_BOOT after this deploy');
      }
    } else {
      console.warn('[assets] Dry-run only — no assets deleted, completion lock not set');
    }
  } catch (err) {
    if (!dryRun) {
      await upsertDocument('system_boot_locks', {
        _id: lockId,
        job: 'dedupe_asset_serials',
        status: 'failed',
        error: String(err?.message || err),
        updatedAt: new Date().toISOString(),
      });
    }
    console.error('[assets] serial dedupe failed:', err.message);
  }
}

/**
 * One-shot permanent delete of Camp One camps by Division/Therapy (campaignType).
 * Exact match only (trim + case fold) — e.g. MOM matches "MOM"/" mom " but not "MOM Camp".
 * Example: PURGE_CAMPS_BY_CAMPAIGN_TYPE_ON_BOOT=MOM
 * Dry-run: PURGE_CAMPS_BY_CAMPAIGN_TYPE_ON_BOOT_DRY_RUN=true
 */
async function maybeHardDeleteCampsByCampaignTypeOnBoot() {
  const { maybeHardDeleteCampsByCampaignTypeOnBoot: runHardDeleteCampsByCampaignTypeOnBoot } =
    await import('./utils/hardDeleteCampsByCampaignTypeOnBoot.js');
  await runHardDeleteCampsByCampaignTypeOnBoot();
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
  await maybeHardDeleteCampsByCampaignTypeOnBoot();
  await maybeDedupeAssetSerialsOnBoot();
  try {
    const { maybeCanonicalizeDieticianSpellingOnBoot } = await import(
      './utils/canonicalizeDieticianSpelling.js'
    );
    await maybeCanonicalizeDieticianSpellingOnBoot();
  } catch (err) {
    console.error('[spelling] Dietician boot canonicalize failed:', err.message);
  }
  ensureUploadDirs();
  await hydrateEmailIngestState();
  await maybeFreshStart();
  await maybePurgeAllCampsOnBoot();
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
    import('./modules/notifications/notificationArchive.js')
      .then(({ archiveExpiredNotifications }) => {
        const run = () =>
          archiveExpiredNotifications({ limit: 1000 })
            .then((r) => {
              if (r.archived) {
                console.warn(
                  `[notifications] 7-day TTL archive: scanned=${r.scanned} archived=${r.archived}`,
                );
              }
            })
            .catch((err) => console.error('[notifications] 7-day TTL archive failed:', err.message));
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
