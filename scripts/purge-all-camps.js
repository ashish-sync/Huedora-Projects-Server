/**
 * Soft-delete all Camp One camps (all stages).
 *
 * Usage:
 *   node scripts/purge-all-camps.js
 *   node scripts/purge-all-camps.js --dry-run
 *
 * For production Atlas, run with USE_MONGOOSE=true and MONGODB_URI set
 * (Render Shell inherits those automatically).
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import { purgeAllCamps } from '../src/utils/purgeAllCamps.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  await connectDb();
  await import('../src/modules/campOps/campOps.model.js');

  if (dryRun) {
    const { CampOpsCamp } = await import('../src/modules/campOps/campOps.model.js');
    const active = await CampOpsCamp.countDocuments({ isDeleted: false });
    console.log(JSON.stringify({ dryRun: true, wouldPurge: active }, null, 2));
    await disconnectDb();
    return;
  }

  const result = await purgeAllCamps({ actorId: 'script:purge-all-camps' });
  console.log(JSON.stringify(result, null, 2));
  console.log('[purge-all-camps] Done. Camps are soft-deleted and hidden from Manage Camps.');
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
