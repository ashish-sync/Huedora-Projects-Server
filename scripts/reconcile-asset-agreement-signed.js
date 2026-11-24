/**
 * Reset Asset One "Agreement Signed" / "Active" rows that have no document
 * under Actions back to "Not Initiated".
 *
 * Usage (from server/):
 *   node scripts/reconcile-asset-agreement-signed.js
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import { reconcileAgreementSignedWithoutDocuments } from '../src/modules/assets/assetAgreementDocument.js';

async function main() {
  await connectDb();
  const result = await reconcileAgreementSignedWithoutDocuments();
  console.log(JSON.stringify(result, null, 2));
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
