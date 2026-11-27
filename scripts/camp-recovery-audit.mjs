/**
 * Read-only Camp One recovery inventory.
 *
 * Usage:
 *   node scripts/camp-recovery-audit.mjs
 *   node scripts/camp-recovery-audit.mjs --csv > recovery-inventory.csv
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import {
  buildCampRecoveryInventory,
  recoveryInventoryToCsv,
} from '../src/modules/campOps/campRecoveryInventory.js';

const asCsv = process.argv.includes('--csv');

async function main() {
  await connectDb();
  await import('../src/modules/campOps/campOps.model.js');
  const inventory = await buildCampRecoveryInventory();
  if (asCsv) {
    process.stdout.write(recoveryInventoryToCsv(inventory));
    process.stdout.write('\n');
  } else {
    console.log(JSON.stringify(inventory, null, 2));
  }
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
