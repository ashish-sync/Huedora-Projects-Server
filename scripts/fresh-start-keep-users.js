/**
 * Production-safe wipe: clears camps, assets, products, masters, finance, etc.
 * Keeps users, roles, and refresh tokens.
 *
 * Usage (from server/ with production MONGODB_URI):
 *   node scripts/fresh-start-keep-users.js
 *   node scripts/fresh-start-keep-users.js --dry-run
 *
 * Or on Render: set FRESH_START_KEEP_USERS_ON_BOOT=true for one deploy, then turn it off.
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import { ensureSeed } from '../src/seed.js';
import { env } from '../src/config/env.js';
import { freshStartKeepUsers } from '../src/utils/freshStartKeepUsers.js';

// Import models so file-store collections are registered before wipe.
await import('../src/modules/users/user.model.js');
await import('../src/modules/users/role.model.js');
await import('../src/modules/auth/refreshToken.model.js');
await import('../src/modules/campOps/campOps.model.js');
await import('../src/modules/assets/asset.model.js');
await import('../src/modules/logistics/logistics.model.js');
await import('../src/modules/contacts/contact.model.js');
await import('../src/modules/finance/finance.model.js');
await import('../src/modules/geo/geo.model.js');
await import('../src/modules/devices/device.model.js');
await import('../src/modules/agreements/agreement.model.js');
await import('../src/modules/templates/template.model.js');
await import('../src/modules/signatures/signature.model.js');
await import('../src/modules/assetRequests/assetRequest.model.js');
await import('../src/modules/verifications/verification.model.js');
await import('../src/modules/picklists/picklist.model.js');
await import('../src/modules/movements/movement.model.js');
await import('../src/modules/repairs/repair.model.js');
await import('../src/modules/documents/document.model.js');
await import('../src/modules/notifications/notification.model.js');
await import('../src/modules/imports/importJob.model.js');
await import('../src/modules/audit/audit.model.js');
await import('../src/modules/hcws/hcw.model.js');
await import('../src/modules/common/counter.model.js');

const dryRun = process.argv.includes('--dry-run');

async function main() {
  await connectDb();
  if (dryRun) {
    console.log('[fresh-start] Dry run — would clear all collections except users, roles, refresh_tokens');
    console.log(`[fresh-start] Persistence mode: ${env.nodeEnv}`);
    await disconnectDb();
    return;
  }

  const result = await freshStartKeepUsers();
  // Restore reference geo / system roles / logistics picklists. Camp One demo stays off in production.
  await ensureSeed();
  console.log('[fresh-start] Done.', {
    kept: result.kept,
    clearedCount: result.cleared.length,
  });
  await disconnectDb();
}

main().catch((err) => {
  console.error('[fresh-start] Failed:', err);
  process.exit(1);
});
