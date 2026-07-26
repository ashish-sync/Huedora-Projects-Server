import { connectDb, disconnectDb } from '../src/config/db.js';
import { forceReseedGeoMasters } from '../src/modules/geo/geo.seed.js';

async function main() {
  await connectDb();
  const result = await forceReseedGeoMasters();
  console.log('[geo:reseed] Complete:', JSON.stringify(result, null, 2));
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
