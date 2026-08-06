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
  throwIfIdentityClash,
} from '../src/utils/identityNormalize.js';
import { readCsvTextSync, withUtf8Bom } from '../src/utils/csvEncoding.js';
import { inferAccessProfile, TEAM_ACCESS_PROFILES } from './teamAccessProfiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'out');

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
export function parseCsv(text) {
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

async function loadRoles() {
  const roles = await Role.find({ isDeleted: false });
  const byName = new Map();
  for (const role of roles) {
    byName.set(role.name, role);
  }
  return byName;
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

function resolveAccessProfileRoles(row, defaultRole, roleByName, dryRunMode) {
  const profileKey = inferAccessProfile(row);
  if (profileKey) {
    const profile = TEAM_ACCESS_PROFILES[profileKey];
    const names = profile.roleNames || [];
    const ids = [];
    for (const name of names) {
      const role = roleByName.get(name);
      if (!role && dryRunMode) {
        return { names, ids: [], profileKey };
      }
      if (!role) {
        throw new Error(
          `Standard role "${name}" is missing — run npm run seed or restart the server`,
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
      row.reportingtoemail || row['reporting to email'] || row.manageremail,
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

/**
 * Import TYLO One team users from a CSV file.
 * Used by the CLI script and production boot recovery.
 */
export async function runTeamUsersImport({
  csvPath,
  dryRun = false,
  resetPassword = false,
  updateExisting = false,
  skipConnect = false,
  skipDisconnect = false,
  skipSeed = false,
  writeReport = true,
  defaultPassword: passwordOverride = '',
  passwordHash: passwordHashOverride = '',
} = {}) {
  if (!csvPath) {
    throw new Error('csvPath is required');
  }

  const resolvedCsv = path.resolve(csvPath);
  if (!fs.existsSync(resolvedCsv)) {
    throw new Error(`CSV not found: ${resolvedCsv}`);
  }

  const defaultPassword = String(passwordOverride || process.env.BULK_USERS_DEFAULT_PASSWORD || '').trim();
  const envPasswordHash = String(passwordHashOverride || process.env.TEAM_USERS_PASSWORD_HASH || '').trim();

  let passwordHash = null;
  if (!dryRun) {
    if (envPasswordHash) {
      passwordHash = envPasswordHash;
    } else if (defaultPassword && defaultPassword.length >= 12) {
      passwordHash = await bcrypt.hash(defaultPassword, 12);
    } else {
      throw new Error(
        'Set BULK_USERS_DEFAULT_PASSWORD (min 12 characters) or TEAM_USERS_PASSWORD_HASH before running.',
      );
    }
  }

  const defaultRole = String(process.env.BULK_USERS_DEFAULT_ROLE || 'Viewer').trim();
  const table = parseCsv(readCsvTextSync(resolvedCsv));
  const records = rowsToObjects(table).filter((row) => row.email);

  if (!records.length) {
    throw new Error('No data rows found in CSV (need at least email column).');
  }

  if (!skipConnect) {
    await connectDb();
  }
  if (!skipSeed) {
    await ensureSeed();
  }

  let roleByName = await loadRoles();
  roleByName = await loadRoles();

  let allUsers = await User.find({ isDeleted: false }).limit(20000);

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
        roleByName,
        dryRun,
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
        row.reportingtoemail || row['reporting to email'] || row.manageremail,
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
        (u) => !u.isDeleted && u.username === username && normalizeEmail(u.email) !== emailKey,
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

  if (writeReport) {
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
          .join(','),
      ),
    ];
    fs.writeFileSync(outPath, withUtf8Bom(`${lines.join('\n')}\n`), 'utf8');
    console.log(`[bulk-users] Credentials report: ${outPath}`);
  }

  console.log(
    `[bulk-users] Done. created=${created} updated=${updated} skipped=${skipped} reporting=${reportingLinked} dryRun=${dryRun}`,
  );

  if (!skipDisconnect) {
    await disconnectDb();
  }

  return { created, updated, skipped, reportingLinked };
}
