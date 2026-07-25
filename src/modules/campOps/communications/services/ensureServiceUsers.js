import { User } from '../models.js';
import { CampOpsClient as Client } from '../models.js';
import { PENDING_IMPORT_CLIENT_NAME } from '../utils/campMessageParser.js';
import { buildClientCode } from '../../campOps.helpers.js';

export const PENDING_EMAIL_CLIENT_CODE = 'EMAIL-PENDING';
export const PENDING_EMAIL_CLIENT_NAME = PENDING_IMPORT_CLIENT_NAME;

const SERVICE_BOTS = [
  {
    envKey: 'WHATSAPP_SERVICE_USER_EMAIL',
    defaultEmail: 'whatsapp-bot@huedoraconnect.com',
    name: 'WhatsApp Bot',
  },
  {
    envKey: 'EMAIL_SERVICE_USER_EMAIL',
    defaultEmail: 'email-bot@huedoraconnect.com',
    name: 'Email Bot',
  },
];

export async function ensurePendingEmailClient() {
  const existing = await Client.findOne({ code: PENDING_EMAIL_CLIENT_CODE, isDeleted: false });
  if (existing) return existing;

  const client = await Client.create({
    name: PENDING_EMAIL_CLIENT_NAME,
    code: PENDING_EMAIL_CLIENT_CODE,
    isActive: true,
  });

  console.log(`[ingest] Created pending email client ${PENDING_EMAIL_CLIENT_NAME}`);
  return client;
}

export async function ensureServiceUsers() {
  for (const bot of SERVICE_BOTS) {
    const email = (process.env[bot.envKey] || bot.defaultEmail).toLowerCase();
    const existing = await User.findOne({ email, isDeleted: false });
    if (existing) continue;

    await User.create({
      fullName: bot.name,
      name: bot.name,
      email,
      passwordHash: '$2a$10$servicebotnotforloginplaceholderhashvalue000000',
      isActive: true,
      roleIds: [],
    });

    console.log(`[ingest] Created service user ${email}`);
  }

  await ensurePendingEmailClient();
}
