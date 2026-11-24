/**
 * Idempotent: create Demo Asset — Document One Lease and link it to the
 * Document One demo agreement.
 *
 * Usage (from server/):
 *   node scripts/seed-asset-one-document-demo.js
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import { ensureAssetOneAgreementDemo, ASSET_ONE_DEMO } from '../src/modules/assets/assetOne.seed.js';
import { DOCUMENT_ONE_DEMO } from '../src/modules/agreements/documentOne.seed.js';

async function main() {
  await connectDb();
  const result = await ensureAssetOneAgreementDemo();
  console.log(
    JSON.stringify(
      {
        ...result,
        serialNumber: ASSET_ONE_DEMO.serialNumber,
        agreementTitle: DOCUMENT_ONE_DEMO.title,
      },
      null,
      2,
    ),
  );
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
