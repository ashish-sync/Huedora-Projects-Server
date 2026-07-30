/**
 * Remove dev/test users leaked into the local JSON database by automated tests.
 * Run from server/: node scripts/purge-test-users.js
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import { User } from '../src/modules/users/user.model.js';
import { CampOpsClientMaster } from '../src/modules/campOps/campOps.model.js';

function isTestUserEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value) return false;
  if (value.endsWith('@test.com')) return true;
  return false;
}

function isTestClientMaster(row = {}) {
  const name = String(row.clientName || '').trim();
  return name === 'Demo Client';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await connectDb();

  const users = await User.find({});
  const testUsers = users.filter((u) => isTestUserEmail(u.email) && !u.isDeleted);

  const masters = await CampOpsClientMaster.find({ isDeleted: false });
  const testMasters = masters.filter(isTestClientMaster);

  console.log(`[purge-test-users] found ${testUsers.length} test user(s), ${testMasters.length} test client master(s)`);

  if (!dryRun) {
    for (const user of testUsers) {
      user.isDeleted = true;
      user.deletedAt = new Date().toISOString();
      user.isActive = false;
      await user.save();
      console.log(`[purge-test-users] removed user ${user.email}`);
    }
    for (const row of testMasters) {
      row.isDeleted = true;
      row.deletedAt = new Date().toISOString();
      await row.save();
      console.log(`[purge-test-users] removed client master ${row.clientId}`);
    }
  }

  console.log(dryRun ? '[purge-test-users] dry run only' : '[purge-test-users] done');
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
