/**
 * Bulk-create TYLO One login accounts from a CSV file.
 *
 * Usage (from server/):
 *   $env:BULK_USERS_DEFAULT_PASSWORD="TyloCare@2026"
 *   node scripts/bulk-import-users.js --file scripts/data/team-users-tylocare.csv
 *
 * Options:
 *   --file <path>          CSV input (required unless --generate-template)
 *   --dry-run              Validate only; do not write users
 *   --reset-password       Reset password for emails that already exist
 *   --update-existing      Update role, designation, and reporting manager for existing users
 *   --generate-template    Write scripts/data/team-users.template.csv (25 blank rows)
 *
 * Environment:
 *   BULK_USERS_DEFAULT_PASSWORD   Required. Min 12 characters (applied to all new users).
 *   BULK_USERS_DEFAULT_ROLE       Optional. Default role name when no accessProfile (default: Viewer).
 *
 * CSV columns (header row required):
 *   email, fullName, username, phone, designation, role, accessProfile, reportingToEmail
 *   - accessProfile: full_access | camp_coordinator | logistics_associate
 *     (or infer from view/edit/approve columns)
 *   - role: optional legacy role name(s); ignored when accessProfile is set
 *   - reportingToEmail: manager email (resolved after all rows are created)
 *
 * Writes credentials report to scripts/out/team-users-credentials-<timestamp>.csv (gitignored).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runTeamUsersImport } from './teamUsersImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const TEMPLATE_PATH = path.join(DATA_DIR, 'team-users.template.csv');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const resetPassword = args.includes('--reset-password');
const updateExisting = args.includes('--update-existing');
const generateTemplate = args.includes('--generate-template');
const fileArgIndex = args.indexOf('--file');
const csvPath = fileArgIndex >= 0 ? args[fileArgIndex + 1] : '';

function writeTemplate() {
  const header = 'email,fullName,designation,accessProfile,reportingToEmail';
  const lines = [header];
  for (let i = 1; i <= 25; i += 1) {
    const n = String(i).padStart(2, '0');
    lines.push(
      `member${n}@yourcompany.com,Team Member ${n},,camp_coordinator,manager@yourcompany.com`,
    );
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TEMPLATE_PATH, `${lines.join('\n')}\n`, 'utf8');
  console.log(`[bulk-users] Template written: ${TEMPLATE_PATH}`);
  console.log('[bulk-users] Edit emails and profiles, save as team-users.csv, then run import.');
}

async function main() {
  if (generateTemplate) {
    writeTemplate();
    return;
  }

  if (!csvPath) {
    console.error('Missing --file <path.csv> (or use --generate-template)');
    process.exit(1);
  }

  await runTeamUsersImport({
    csvPath: path.resolve(process.cwd(), csvPath),
    dryRun,
    resetPassword,
    updateExisting,
  });

  console.log('[bulk-users] Share passwords securely; ask users to change password after first login.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
