/**
 * Camp ID integrity migration — inventory, counter init, optional gated dedupe.
 *
 * Usage:
 *   node scripts/camp-id-integrity-migrate.mjs
 *   node scripts/camp-id-integrity-migrate.mjs --init-counters
 *   node scripts/camp-id-integrity-migrate.mjs --dedupe          # dry-run report
 *   TYLO_CAMP_ID_DEDUP=1 node scripts/camp-id-integrity-migrate.mjs --dedupe --apply
 *
 * Default is inventory-only (read-only). Never renumbers unique historical IDs.
 * Dedupe only assigns NEW IDs to newer colliding rows (oldest kept).
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import {
  inventoryCampIds,
  initializeAllCampIdCounters,
  dedupeDuplicateCampIds,
  findDuplicateCampIdGroups,
} from '../src/modules/campOps/campIdSequence.js';

const args = new Set(process.argv.slice(2));
const initCounters = args.has('--init-counters');
const dedupe = args.has('--dedupe');
const apply = args.has('--apply');

async function main() {
  await connectDb();
  await import('../src/modules/campOps/campOps.model.js');

  console.log('[camp-id-integrity] Inventory…');
  const inventory = await inventoryCampIds();
  console.log(
    JSON.stringify(
      {
        totalCamps: inventory.totalCamps,
        indexReady: inventory.indexReady,
        duplicateGroups: inventory.duplicates.length,
        months: inventory.months,
        duplicates: inventory.duplicates,
      },
      null,
      2
    )
  );

  if (initCounters) {
    console.log('[camp-id-integrity] Initializing counters from existing camps…');
    const results = await initializeAllCampIdCounters();
    console.log(JSON.stringify({ counters: results }, null, 2));
  }

  if (dedupe) {
    if (apply && String(process.env.TYLO_CAMP_ID_DEDUP || '') !== '1') {
      console.error(
        '[camp-id-integrity] Refusing --apply without TYLO_CAMP_ID_DEDUP=1 (gated remediation).'
      );
      process.exitCode = 2;
      await disconnectDb();
      return;
    }
    console.log(
      apply
        ? '[camp-id-integrity] Applying gated dedupe…'
        : '[camp-id-integrity] Dedupe dry-run (no writes)…'
    );
    const result = await dedupeDuplicateCampIds({
      dryRun: !apply,
      apply,
      actorId: 'script:camp-id-integrity-migrate',
    });
    console.log(JSON.stringify(result, null, 2));

    if (apply) {
      const remaining = await findDuplicateCampIdGroups();
      console.log(
        JSON.stringify(
          {
            remainingDuplicates: remaining.length,
            indexReady: remaining.length === 0,
          },
          null,
          2
        )
      );
      if (remaining.length === 0) {
        console.log(
          '[camp-id-integrity] Zero duplicates — Mongo uniq_campId index is safe to ensure on next boot.'
        );
      }
    }
  } else if (!inventory.indexReady) {
    console.log(
      '[camp-id-integrity] Duplicates present. Run with --dedupe for a dry-run plan, then TYLO_CAMP_ID_DEDUP=1 --dedupe --apply after approval.'
    );
  }

  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
