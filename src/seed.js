import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from './config/db.js';
import { env } from './config/env.js';
import { ROLE_PERMISSIONS } from './config/constants.js';
import { Role } from './modules/users/role.model.js';
import { User } from './modules/users/user.model.js';
import { DocumentTemplate } from './modules/templates/template.model.js';
import { Contact } from './modules/contacts/contact.model.js';

const LEASE_TEMPLATE = `ASSET LEASE AGREEMENT

This Lease Agreement is entered into between the Company ("Lessor") and the Counterparty ("Lessee").

1. EQUIPMENT
The Lessor leases the medical device(s) described in the linked inventory to the Lessee.

2. TERM
The lease begins on the Start Date and continues until the End Date unless earlier terminated.

3. CARE & USE
Lessee shall use the equipment only for its intended medical purpose and maintain it in good condition.

4. VERIFICATION
Lessee shall cooperate with periodic physical and functionality verification by the Company.

5. RETURN
Upon expiry or termination, Lessee shall return the equipment as directed by the Company.

The parties execute this Agreement by electronic signature.`;

const TEMP_OWNERSHIP_TEMPLATE = `TEMPORARY OWNERSHIP / CUSTODY AGREEMENT

This Agreement grants temporary custody of the listed medical device(s) to the Counterparty.

1. CUSTODY
Counterparty accepts temporary custody and responsibility for the asset(s).

2. DURATION
Custody begins on the Start Date and ends on the End Date, or upon earlier recall by the Company.

3. LOSS OR DAMAGE
Counterparty shall immediately report loss, theft, or damage.

4. NO TRANSFER
Counterparty shall not transfer custody to any third party without written approval.

5. RETURN
Assets shall be returned in working order at the end of the custody period.

Signed electronically by the parties.`;

function canBootstrapAdmin() {
  const email = env.bootstrapAdminEmail;
  const password = env.bootstrapAdminPassword;
  if (!email || !password) return false;
  if (password.length < 12) {
    console.warn(
      '[seed] BOOTSTRAP_ADMIN_PASSWORD ignored — must be at least 12 characters'
    );
    return false;
  }
  return true;
}

export async function ensureSeed() {
  // Create built-in roles once. Never overwrite permissions on restart —
  // admins customize access in Roles & Permissions and those edits must stick.
  for (const [name, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    const existing = await Role.findOne({ name });
    if (!existing) {
      await Role.create({
        name,
        permissions,
        description: `${name} role`,
        isSystem: true,
        isDeleted: false,
      });
      continue;
    }
    let dirty = false;
    if (existing.isDeleted) {
      existing.isDeleted = false;
      dirty = true;
    }
    if (existing.isSystem !== true) {
      existing.isSystem = true;
      dirty = true;
    }
    // Admin must always retain full access
    if (name === 'Admin') {
      const perms = Array.isArray(existing.permissions) ? existing.permissions : [];
      if (!perms.includes('*')) {
        existing.permissions = ['*'];
        dirty = true;
      }
    }
    if (dirty) await existing.save();
  }

  // Repair users that previously saved populated role documents into roleIds
  const allUsers = await User.find({});
  for (const u of allUsers) {
    if (!Array.isArray(u.roleIds) || !u.roleIds.length) continue;
    const needsFix = u.roleIds.some((id) => id && typeof id === 'object');
    if (!needsFix) continue;
    u.roleIds = u.roleIds.map((id) => String(id?._id || id)).filter(Boolean);
    await u.save();
  }

  const adminRole = await Role.findOne({ name: 'Admin' });
  const managerRole = await Role.findOne({ name: 'AssetManager' });
  const verifierRole = await Role.findOne({ name: 'Verifier' });
  const approverRole = await Role.findOne({ name: 'Approver' });

  // First-run admin only when credentials are explicitly provided
  if (canBootstrapAdmin() && adminRole) {
    const existing = await User.findOne({ email: env.bootstrapAdminEmail });
    if (!existing) {
      const passwordHash = await bcrypt.hash(env.bootstrapAdminPassword, 12);
      await User.create({
        email: env.bootstrapAdminEmail,
        username: env.bootstrapAdminEmail.split('@')[0] || 'admin',
        fullName: env.bootstrapAdminName || 'Administrator',
        passwordHash,
        roleIds: [adminRole._id],
        isActive: true,
      });
      console.log(`[seed] Bootstrap admin created: ${env.bootstrapAdminEmail}`);
    }
  } else {
    const anyUser = await User.countDocuments({ isDeleted: false });
    if (!anyUser) {
      console.warn(
        '[seed] No users found. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (12+ chars) once to create the first admin, or create a user via an existing admin.'
      );
    }
  }

  // Optional local demo accounts — never in production
  if (env.seedDemoUsers && managerRole && verifierRole && approverRole && canBootstrapAdmin()) {
    const passwordHash = await bcrypt.hash(env.bootstrapAdminPassword, 12);
    const extras = [
      {
        email: 'manager@dhub.local',
        username: 'manager',
        fullName: 'Asset Manager',
        roleIds: [managerRole._id, approverRole._id],
      },
      {
        email: 'verifier@dhub.local',
        username: 'verifier',
        fullName: 'Field Verifier',
        roleIds: [verifierRole._id],
      },
    ];
    for (const e of extras) {
      const existing = await User.findOne({ email: e.email });
      if (!existing) {
        await User.create({ ...e, passwordHash, isActive: true });
        console.log(`[seed] Demo user created: ${e.email}`);
      }
    }
  }

  if (env.seedAgreementSamples) {
    const templates = [
      {
        name: 'Standard Device Lease',
        agreementType: 'LEASE',
        description: 'Default lease for medical devices placed with a counterparty.',
        bodyHtml: LEASE_TEMPLATE,
      },
      {
        name: 'Temporary Ownership / Custody',
        agreementType: 'TEMPORARY_OWNERSHIP',
        description: 'Temporary custody transfer with return obligations.',
        bodyHtml: TEMP_OWNERSHIP_TEMPLATE,
      },
      {
        name: 'Short-Term Demo Loan',
        agreementType: 'LEASE',
        description: 'Short evaluation / demo placement letter.',
        bodyHtml: `${LEASE_TEMPLATE}\n\nADDENDUM: This placement is for evaluation/demo use only.`,
      },
    ];

    for (const t of templates) {
      const existing = await DocumentTemplate.findOne({ name: t.name, isDeleted: false });
      if (!existing) {
        await DocumentTemplate.create({ ...t, category: 'AGREEMENT', isActive: true });
        console.log(`[seed] Template created: ${t.name}`);
      }
    }

    const sampleContact = await Contact.findOne({ email: 'priya.sharma@citycare.example' });
    if (!sampleContact) {
      await Contact.create({
        name: 'Priya Sharma',
        email: 'priya.sharma@citycare.example',
        resourceType: 'Full Timer',
        profession: 'Camp Coordinator',
        contact: '+91 98765 43210',
        mobile: '+91 98765 43210',
        state: 'Maharashtra',
        city: 'Pune',
      });
      console.log('[seed] Sample contact created');
    }
  }

  return {};
}

async function run() {
  await connectDb();
  await ensureSeed();
  console.log('[seed] Complete');
  if (env.useMemoryDb) {
    console.log('[seed] Note: memory DB is process-local; prefer npm run dev which seeds on boot.');
  }
  await disconnectDb();
}

const isDirect = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/seed.js');
if (isDirect) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
