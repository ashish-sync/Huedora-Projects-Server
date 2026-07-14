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

export async function ensureSeed() {
  for (const [name, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    await Role.findOneAndUpdate(
      { name },
      {
        $set: {
          name,
          permissions,
          description: `${name} role`,
          isSystem: true,
          isDeleted: false,
        },
      },
      { upsert: true, new: true }
    );
  }

  const adminRole = await Role.findOne({ name: 'Admin' });
  const managerRole = await Role.findOne({ name: 'AssetManager' });
  const verifierRole = await Role.findOne({ name: 'Verifier' });
  const approverRole = await Role.findOne({ name: 'Approver' });

  const passwordHash = await bcrypt.hash(env.bootstrapAdminPassword, 12);

  // Migrate legacy @alms.local demo accounts to @dhub.local
  const emailMigrations = [
    ['admin@alms.local', env.bootstrapAdminEmail],
    ['manager@alms.local', 'manager@dhub.local'],
    ['verifier@alms.local', 'verifier@dhub.local'],
  ];
  for (const [from, to] of emailMigrations) {
    if (!from || !to || from === to) continue;
    const legacy = await User.findOne({ email: from });
    const target = await User.findOne({ email: to });
    if (legacy && !target) {
      legacy.email = to;
      if (from.startsWith('admin@')) legacy.fullName = env.bootstrapAdminName;
      await legacy.save();
      console.log(`[seed] Migrated user ${from} → ${to}`);
    }
  }

  let admin = await User.findOne({ email: env.bootstrapAdminEmail });
  if (!admin) {
    admin = await User.create({
      email: env.bootstrapAdminEmail,
      username: 'admin',
      fullName: env.bootstrapAdminName,
      passwordHash,
      roleIds: [adminRole._id],
      isActive: true,
    });
    console.log(`[seed] Admin user created: ${env.bootstrapAdminEmail}`);
  }

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
      console.log(`[seed] User created: ${e.email}`);
    }
  }

  const seedAgreementSamples = env.seedAgreementSamples !== false;
  if (seedAgreementSamples) {
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
    } else {
      // enrich older sample records
      if (!sampleContact.resourceType || sampleContact.resourceType === 'HCW') {
        sampleContact.resourceType = 'Full Timer';
        sampleContact.profession = sampleContact.profession === 'Coordinator' || !sampleContact.profession
          ? 'Camp Coordinator'
          : sampleContact.profession;
        sampleContact.contact = sampleContact.contact || sampleContact.mobile || '+91 98765 43210';
        sampleContact.mobile = sampleContact.contact;
        await sampleContact.save();
      }
    }
  }

  return { admin };
}

async function run() {
  await connectDb();
  await ensureSeed();
  console.log('[seed] Complete');
  console.log(`  Admin: ${env.bootstrapAdminEmail} / ${env.bootstrapAdminPassword}`);
  console.log('  Manager: manager@dhub.local / (same password)');
  console.log('  Verifier: verifier@dhub.local / (same password)');
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
