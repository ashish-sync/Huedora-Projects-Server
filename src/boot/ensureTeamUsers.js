import path from 'path';
import { fileURLToPath } from 'url';
import { User } from '../modules/users/user.model.js';
import { runTeamUsersImport } from '../../scripts/teamUsersImport.js';
import { TEAM_TEMP_PASSWORD_HASH } from './teamUsersDefaults.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CSV = path.resolve(__dirname, '../../scripts/data/team-users-tylocare.csv');
const EXPECTED_MIN_TEAM_USERS = 20;

/**
 * Ensures TYLO Care team accounts from the bundled CSV exist in the database.
 * Runs when fewer than EXPECTED_MIN_TEAM_USERS @tylocare.com users exist, or when
 * TEAM_USERS_IMPORT_ON_BOOT=true (one-shot recovery / password reset).
 */
export async function ensureTeamUsersInDatabase() {
  const forceImport = String(process.env.TEAM_USERS_IMPORT_ON_BOOT || '').toLowerCase() === 'true';
  const count = await User.countDocuments({
    email: /@tylocare\.com$/i,
    isDeleted: false,
    isActive: { $ne: false },
  });

  if (!forceImport && count >= EXPECTED_MIN_TEAM_USERS) return;

  const password = String(process.env.BULK_USERS_DEFAULT_PASSWORD || '').trim();
  const passwordHash =
    String(process.env.TEAM_USERS_PASSWORD_HASH || '').trim() || TEAM_TEMP_PASSWORD_HASH;

  if (!password && !passwordHash) {
    if (count < EXPECTED_MIN_TEAM_USERS) {
      console.warn(
        `[team-users] Only ${count} active @tylocare.com user(s) in database (expected ~22). `
          + 'Team import could not run.',
      );
    }
    return;
  }

  const csv = process.env.TEAM_USERS_CSV
    ? path.resolve(process.cwd(), process.env.TEAM_USERS_CSV)
    : DEFAULT_CSV;

  const needsFullRoster = count < EXPECTED_MIN_TEAM_USERS;
  const resetPassword =
    needsFullRoster
    || (forceImport
      && String(process.env.TEAM_USERS_RESET_PASSWORD_ON_BOOT || 'true').toLowerCase() === 'true');

  console.warn(
    `[team-users] Importing team users (existing=${count}, force=${forceImport}, resetPassword=${resetPassword})...`,
  );

  const result = await runTeamUsersImport({
    csvPath: csv,
    resetPassword,
    updateExisting: true,
    skipConnect: true,
    skipDisconnect: true,
    skipSeed: true,
    writeReport: false,
    defaultPassword: password,
    passwordHash: password ? '' : passwordHash,
  });

  console.warn(
    `[team-users] Import complete. created=${result.created} updated=${result.updated} `
      + `skipped=${result.skipped} reporting=${result.reportingLinked}.`,
  );

  if (forceImport) {
    console.warn('[team-users] Set TEAM_USERS_IMPORT_ON_BOOT=false after verifying team login.');
  }
}
