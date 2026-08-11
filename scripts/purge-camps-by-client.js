/**
 * Soft-delete Camp One camps by Client Name.
 *
 * Usage:
 *   node scripts/purge-camps-by-client.js --dry-run --clients "UNS-1,UNS-2"
 *   node scripts/purge-camps-by-client.js --clients "UNS-1,UNS-2"
 *
 * For production Atlas, run with USE_MONGOOSE=true and MONGODB_URI set
 * (Render Shell inherits those automatically).
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import {
  countCampsByClientNames,
  purgeCampsByClientNames,
} from '../src/utils/purgeAllCamps.js';

const dryRun = process.argv.includes('--dry-run');

function parseClients() {
  const flagIndex = process.argv.findIndex((arg) => arg === '--clients' || arg.startsWith('--clients='));
  if (flagIndex < 0) return [];
  const raw = process.argv[flagIndex].includes('=')
    ? process.argv[flagIndex].split('=').slice(1).join('=')
    : process.argv[flagIndex + 1];
  return String(raw || '')
    .split(/[,;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function main() {
  const clientNames = parseClients();
  if (!clientNames.length) {
    throw new Error('Pass --clients "UNS-1,UNS-2"');
  }

  await connectDb();
  await import('../src/modules/campOps/campOps.model.js');

  const preview = await countCampsByClientNames(clientNames);
  console.log(JSON.stringify({ dryRun, clientNames, preview }, null, 2));

  if (dryRun) {
    await disconnectDb();
    return;
  }

  if (!preview.total) {
    console.log('[purge-camps-by-client] No matching active camps.');
    await disconnectDb();
    return;
  }

  const result = await purgeCampsByClientNames(clientNames, {
    actorId: 'script:purge-camps-by-client',
  });
  console.log(JSON.stringify(result, null, 2));
  console.log('[purge-camps-by-client] Done. Matching camps are soft-deleted and hidden from Manage Camps.');
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
