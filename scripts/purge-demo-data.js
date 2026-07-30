import { connectDb, disconnectDb } from '../src/config/db.js';
import { purgeDemoData } from '../src/utils/purgeDemoData.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  await connectDb();
  const summary = await purgeDemoData({ dryRun });
  console.log(JSON.stringify(summary, null, 2));
  if (dryRun) {
    console.log('[purge] Dry run only — no records were changed.');
  } else {
    console.log('[purge] Demo/test data removed. Set SEED_CAMP_ONE_DEMO=false to prevent re-seeding on restart.');
  }
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
