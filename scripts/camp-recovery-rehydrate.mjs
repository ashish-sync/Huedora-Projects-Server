/**
 * Gated historical rehydrate from verified audit snapshots.
 *
 * Usage:
 *   node scripts/camp-recovery-rehydrate.mjs
 *   node scripts/camp-recovery-rehydrate.mjs --dry-run
 *   TYLO_CAMP_REHYDRATE=1 node scripts/camp-recovery-rehydrate.mjs --apply
 *   TYLO_CAMP_REHYDRATE=1 node scripts/camp-recovery-rehydrate.mjs --apply --camp-id=26-10-0008
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import { rehydrateHistoricalCamps } from '../src/modules/campOps/campHistoricalRehydrate.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dryRun = !apply || args.includes('--dry-run');
const campIds = args
  .filter((a) => a.startsWith('--camp-id='))
  .map((a) => a.slice('--camp-id='.length).trim())
  .filter(Boolean);

async function main() {
  await connectDb();
  await import('../src/modules/campOps/campOps.model.js');

  if (apply && String(process.env.TYLO_CAMP_REHYDRATE || '') !== '1') {
    console.error('[camp-rehydrate] Refusing --apply without TYLO_CAMP_REHYDRATE=1');
    process.exitCode = 2;
    await disconnectDb();
    return;
  }

  const result = await rehydrateHistoricalCamps({
    dryRun,
    apply,
    actorId: 'script:camp-recovery-rehydrate',
    campIds: campIds.length ? campIds : null,
  });
  console.log(JSON.stringify(result, null, 2));
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
