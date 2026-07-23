import { connectDb, disconnectDb } from '../src/config/db.js';
import { ensureSeed } from '../src/seed.js';
import { resetApplicationData } from '../src/utils/resetApplicationData.js';

async function main() {
  await connectDb();
  await resetApplicationData();
  await ensureSeed();
  console.log('[reset] Fresh database ready');
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
