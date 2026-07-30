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
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { ensureSeed } from '../src/seed.js';
import { User } from '../src/modules/users/user.model.js';
import { Role } from '../src/modules/users/role.model.js';
import {
  assertValidEmail,
  assertValidPhone,
  normalizeEmail,
  normalizePhone,
  throwIfIdentityClash,
} from '../src/utils/identityNormalize.js';
import {
  inferAccessProfile,
  TEAM_ACCESS_PROFILES,
} from './teamAccessProfiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const OUT_DIR = path.join(__dirname, 'out');
const TEMPLATE_PATH = path.join(DATA_DIR, 'team-users.template.csv');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const resetPassword = args.includes('--reset-password');
const updateExisting = args.includes('--update-existing');
const generateTemplate = args.includes('--generate-template');
const fileArgIndex = args.indexOf('--file');
const csvPath = fileArgIndex >= 0 ? args[fileArgIndex + 1] : '';

function normalizeDesignation(value) {
  return String(value || '').trim().slice(0, 120);
}

function deriveUsername(email, explicit) {
  const trimmed = String(explicit || '').trim();
  if (trimmed) return trimmed;
  const local = normalizeEmail(email).split('@')[0] || '';
  return local.replace(/[^a-z0-9._-]/gi, '').slice(0, 48) || 'user';
}

function normalizeManagerEmail(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'na' || raw === 'n/a' || raw === '-') return '';
  return raw;
}

/** Minimal RFC-style CSV parser (quoted fields supported). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
      row = [];
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
  }

  return rows;
}

function rowsToObjects(table) {
  if (!table.length) return [];
  const headers = table[0].map((h) => String(h).trim().toLowerCase());
  return table.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((key, index) => {
      obj[key] = String(cells[index] ?? '').trim();
    });
    return obj;
  });
}

function escapeCsv(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeTemplate() {
  const header = 'email,fullName,designation,accessProfile,reportingToEmail';
  const lines = [header];
  for (let i = 1; i <= 25; i += 1) {
    const n = String(i).padStart(2, '0');
    lines.push(
      `member${n}@yourcompany.com,Team Member ${n},,camp_coordinator,manager@yourcompany.com`
    );
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TEMPLATE_PATH, `${lines.join('\n')}\n`, 'utf8');
  console.log(`[bulk-users] Template written: ${TEMPLATE_PATH}`);
  console.log('[bulk-users] Edit emails and profiles, save as team-users.csv, then run import.');
}

async function loadRoles() {
  const roles = await Role.find({ isDeleted: false });
  const byName = new Map();
  for (const role of roles) {
    byName.set(role.name, role);
  }
  return byName;
}

async function ensureTeamAccessRoles() {
  // Standard roles are created by ensureSeed(); profiles only reference them by name.
}

function resolveRoleNames(roleCell, defaultRole, roleByName) {
  const raw = String(roleCell || '').trim() || defaultRole;
  const names = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const ids = [];
  for (const name of names) {
    const role = roleByName.get(name);
    if (!role) {
      throw new Error(`Unknown role "${name}". Available: ${[...roleByName.keys()].sort().join(', ')}`);
    }
    ids.push(String(role._id));
  }
  return { names, ids: [...new Set(ids)] };
}

function resolveAccessProfileRoles(row, defaultRole, roleByName) {
  const profileKey = inferAccessProfile(row);
  if (profileKey) {
    const profile = TEAM_ACCESS_PROFILES[profileKey];
    const names = profile.roleNames || [];
    const ids = [];
    for (const name of names) {
      const role = roleByName.get(name);
      if (!role && dryRun) {
        return { names, ids: [], profileKey };
      }
      if (!role) {
        throw new Error(
          `Standard role "${name}" is missing — run npm run seed or restart the server`
        );
      }
      ids.push(String(role._id));
    }
    return { names, ids: [...new Set(ids)], profileKey };
  }
  const legacy = resolveRoleNames(row.role, defaultRole, roleByName);
  return { ...legacy, profileKey: '' };
}

async function assertIdentityAvailable({ email, phone, excludeId, allUsers }) {
  const emailKey = email ? assertValidEmail(email, 'Email') : '';
  const phoneKey = phone ? assertValidPhone(phone, 'Mobile number') : '';
  throwIfIdentityClash(allUsers, {
    email: emailKey,
    phone: phoneKey,
    excludeId,
    emailFields: ['email'],
    phoneFields: ['phone'],
    label: 'User',
  });
  return { emailKey, phoneKey };
}

function findUserByEmail(allUsers, email) {
  const key = normalizeEmail(email);
  return allUsers.find((u) => !u.isDeleted && normalizeEmail(u.email) === key);
}

async function applyReportingManagers(records, allUsers, dryRunMode) {
  let linked = 0;
  for (const row of records) {
    const managerEmail = normalizeManagerEmail(
      row.reportingtoemail || row['reporting to email'] || row.manageremail
    );
    if (!managerEmail) continue;

    const user = findUserByEmail(allUsers, row.email);
    const manager = findUserByEmail(allUsers, managerEmail);

    if (dryRunMode) {
      console.log(`[bulk-users] dry-run: ${row.email} → reports to ${managerEmail}`);
      linked += 1;
      continue;
    }

    if (!user) continue;
    if (!manager) {
      console.warn(`[bulk-users] reporting manager not found for ${row.email}: ${managerEmail}`);
      continue;
    }
    if (String(user._id) === String(manager._id)) {
      throw new Error(`User cannot report to themselves: ${row.email}`);
    }

    if (String(user.reportingManagerId || '') !== String(manager._id)) {
      user.reportingManagerId = manager._id;
      await user.save();
      linked += 1;
      console.log(`[bulk-users] reporting: ${row.email} → ${managerEmail}`);
    }
  }
  return linked;
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

  const resolvedCsv = path.resolve(process.cwd(), csvPath);
  if (!fs.existsSync(resolvedCsv)) {
    console.error(`CSV not found: ${resolvedCsv}`);
    process.exit(1);
  }

  const defaultPassword = String(process.env.BULK_USERS_DEFAULT_PASSWORD || '').trim();
  if (!defaultPassword || defaultPassword.length < 12) {
    console.error('Set BULK_USERS_DEFAULT_PASSWORD (min 12 characters) before running.');
    process.exit(1);
  }

  const defaultRole = String(process.env.BULK_USERS_DEFAULT_ROLE || 'Viewer').trim();
  const table = parseCsv(fs.readFileSync(resolvedCsv, 'utf8'));
  const records = rowsToObjects(table).filter((row) => row.email);

  if (!records.length) {
    console.error('No data rows found in CSV (need at least email column).');
    process.exit(1);
  }

  await connectDb();
  await ensureSeed();

  let roleByName = await loadRoles();
  await ensureTeamAccessRoles();
  roleByName = await loadRoles();

  let allUsers = await User.find({ isDeleted: false }).limit(20000);
  const passwordHash = dryRun ? null : await bcrypt.hash(defaultPassword, 12);

  const report = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const [index, row] of records.entries()) {
    const line = index + 2;
    try {
      const email = row.email;
      const fullName = row.fullname || row['full name'] || row.name;
      if (!fullName) throw new Error('fullName is required');

      const username = deriveUsername(email, row.username);
      const { names: roleNames, ids: roleIds, profileKey } = resolveAccessProfileRoles(
        row,
        defaultRole,
        roleByName
      );
      const emailKey = email ? assertValidEmail(email, 'Email') : '';
      const existing = findUserByEmail(allUsers, emailKey);
      const { phoneKey } = await assertIdentityAvailable({
        email,
        phone: row.phone,
        excludeId: existing?._id,
        allUsers,
      });
      const managerEmail = normalizeManagerEmail(
        row.reportingtoemail || row['reporting to email'] || row.manageremail
      );

      if (existing && !resetPassword && !updateExisting) {
        skipped += 1;
        report.push({
          email: emailKey,
          username: existing.username,
          fullName: existing.fullName,
          roles: roleNames.join('; '),
          accessProfile: profileKey,
          reportingTo: managerEmail,
          status: 'skipped (already exists)',
          password: '',
        });
        console.log(`[bulk-users] skip line ${line}: ${emailKey} already exists`);
        continue;
      }

      if (dryRun) {
        report.push({
          email: emailKey,
          username,
          fullName,
          roles: roleNames.join('; '),
          accessProfile: profileKey,
          reportingTo: managerEmail,
          status: existing ? 'would update' : 'would create',
          password: defaultPassword,
        });
        console.log(`[bulk-users] dry-run line ${line}: ${existing ? 'update' : 'create'} ${emailKey}`);
        continue;
      }

      if (existing && (resetPassword || updateExisting)) {
        if (resetPassword) {
          existing.passwordHash = passwordHash;
          existing.passwordChangedAt = new Date().toISOString();
          existing.tokenVersion = (existing.tokenVersion || 0) + 1;
        }
        existing.isActive = true;
        existing.isDeleted = false;
        existing.failedLoginAttempts = 0;
        existing.lockUntil = null;
        existing.fullName = fullName;
        existing.username = username;
        if (row.phone) existing.phone = phoneKey;
        existing.designation = normalizeDesignation(row.designation);
        if (roleIds.length) existing.roleIds = roleIds;
        await existing.save();
        updated += 1;
        report.push({
          email: emailKey,
          username: existing.username,
          fullName: existing.fullName,
          roles: roleNames.join('; '),
          accessProfile: profileKey,
          reportingTo: managerEmail,
          status: resetPassword ? 'updated + password reset' : 'updated',
          password: resetPassword ? defaultPassword : '',
        });
        console.log(`[bulk-users] updated line ${line}: ${emailKey}`);
        continue;
      }

      const usernameClash = allUsers.find(
        (u) => !u.isDeleted && u.username === username && normalizeEmail(u.email) !== emailKey
      );
      if (usernameClash) {
        throw new Error(`username "${username}" already taken`);
      }

      const user = await User.create({
        email: emailKey,
        username,
        fullName,
        phone: phoneKey || String(row.phone || '').trim(),
        designation: normalizeDesignation(row.designation),
        roleIds,
        passwordHash,
        passwordChangedAt: new Date().toISOString(),
        isActive: true,
        failedLoginAttempts: 0,
        lockUntil: null,
      });

      allUsers.push(user);
      created += 1;
      report.push({
        email: emailKey,
        username,
        fullName,
        roles: roleNames.join('; '),
        accessProfile: profileKey,
        reportingTo: managerEmail,
        status: 'created',
        password: defaultPassword,
      });
      console.log(`[bulk-users] created line ${line}: ${emailKey} (${roleNames.join(', ')})`);
    } catch (err) {
      console.error(`[bulk-users] error line ${line}: ${err.message}`);
      report.push({
        email: row.email || '',
        username: row.username || '',
        fullName: row.fullname || '',
        roles: row.role || '',
        accessProfile: row.accessprofile || '',
        reportingTo: row.reportingtoemail || '',
        status: `error: ${err.message}`,
        password: '',
      });
    }
  }

  allUsers = await User.find({ isDeleted: false }).limit(20000);
  const reportingLinked = await applyReportingManagers(records, allUsers, dryRun);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(OUT_DIR, `team-users-credentials-${stamp}.csv`);
  const header = [
    'email',
    'username',
    'fullName',
    'accessProfile',
    'roles',
    'reportingTo',
    'status',
    'temporaryPassword',
  ];
  const lines = [
    header.join(','),
    ...report.map((r) =>
      [
        r.email,
        r.username,
        r.fullName,
        r.accessProfile,
        r.roles,
        r.reportingTo,
        r.status,
        r.password,
      ]
        .map(escapeCsv)
        .join(',')
    ),
  ];
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');

  console.log('');
  console.log(
    `[bulk-users] Done. created=${created} updated=${updated} skipped=${skipped} reporting=${reportingLinked} dryRun=${dryRun}`
  );
  console.log(`[bulk-users] Credentials report: ${outPath}`);
  console.log('[bulk-users] Share passwords securely; ask users to change password after first login.');

  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
