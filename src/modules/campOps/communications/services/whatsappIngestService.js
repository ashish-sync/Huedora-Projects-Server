import { CampOpsCamp as Camp, CampOpsClient as Client, User } from '../models.js';
import { logAudit } from '../audit.adapter.js';
import { createCampFromRow } from '../campCreation.service.js';
import { CampDuplicateError } from '../utils/campDuplicateHelpers.js';
import { sendWhatsAppText } from './whatsappClient.js';
import { ensurePendingEmailClient } from './ensureServiceUsers.js';
import {
  parseCampMessages,
  PENDING_IMPORT_CLIENT_NAME,
  matchClientFromText,
} from '../utils/campMessageParser.js';
import {
  WHATSAPP_HELP_TEXT,
} from '../utils/whatsappParser.js';
import { buildWhatsAppAutoReply } from '../utils/emailReplyTemplates.js';
import { appendIngestReviewRemarks } from '../utils/ingestReviewNotes.js';

export function normalizeWhatsAppPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export async function resolveCreatedByUser(senderPhone) {
  const normalized = normalizeWhatsAppPhone(senderPhone);
  if (normalized) {
    const mappedUser = await User.findOne({
      whatsappPhone: normalized,
      isActive: true,
      isDeleted: false,
    });
    if (mappedUser) return mappedUser;
  }

  const serviceEmail = process.env.WHATSAPP_SERVICE_USER_EMAIL || 'whatsapp-bot@huedoraconnect.com';
  const serviceUser = await User.findOne({ email: serviceEmail, isDeleted: false });
  if (!serviceUser) {
    throw new Error(`WhatsApp service user not found (${serviceEmail}). Run seed or set WHATSAPP_SERVICE_USER_EMAIL.`);
  }

  return serviceUser;
}

async function resolveClientForImport(row, searchText) {
  const clients = await Client.find({ isDeleted: false, isActive: true });
  const clientName = String(row.clientName || '').trim();

  if (clientName && clientName !== PENDING_IMPORT_CLIENT_NAME) {
    const exact = clients.find((client) => client.name.toLowerCase() === clientName.toLowerCase());
    if (exact) return exact;

    const partial = clients.find((client) => clientName.toLowerCase().includes(client.name.toLowerCase().split(' ')[0]));
    if (partial) return partial;
  }

  const matched = matchClientFromText(searchText, clients);
  if (matched) {
    const client = clients.find((item) => item.name.toLowerCase() === matched.toLowerCase());
    if (client) return client;
  }

  return ensurePendingEmailClient();
}

function isHelpMessage(text) {
  const normalized = String(text || '').trim().toLowerCase();
  return ['help', 'format', 'template', 'example'].includes(normalized);
}

function buildIngestId(messageId, rowNumber) {
  return `${messageId}#${rowNumber}`;
}

async function campExists(ingestId) {
  const existing = await Camp.findOne({
    isDeleted: false,
    $or: [{ whatsappMessageId: ingestId }, { emailIngestId: ingestId }],
  });
  return existing || null;
}

async function createCampFromWhatsAppRow({
  row,
  rowNumber,
  message,
  createdBy,
  submittedAt,
}) {
  const ingestId = buildIngestId(message.id, rowNumber);
  const existing = await campExists(ingestId);
  if (existing) {
    return { status: 'duplicate', campId: existing.campId, ingestId, rowNumber };
  }

  const client = await resolveClientForImport(row, message.text);

  let camp;
  try {
    camp = await createCampFromRow({
      row: appendIngestReviewRemarks(row, client),
      client,
      createdBy,
      source: 'whatsapp',
      submittedAt,
      extras: {
        whatsappMessageId: ingestId,
        whatsappSenderPhone: normalizeWhatsAppPhone(message.from),
        whatsappRawMessage: message.text,
      },
    });
  } catch (error) {
    if (error instanceof CampDuplicateError) {
      return {
        status: 'duplicate',
        id: error.existingCamp._id,
        campId: error.existingCamp.campId,
        ingestId,
        rowNumber,
        reason: error.message,
      };
    }
    throw error;
  }

  await logAudit({
    user: createdBy,
    ip: 'whatsapp',
    entityType: 'camp',
    entityId: camp._id,
    action: 'create_whatsapp',
    afterValue: {
      campId: camp.campId,
      whatsappMessageId: ingestId,
      sender: message.from,
    },
  });

  console.log(
    `[whatsapp] Camp created | campId=${camp.campId} | from=${message.from} | row=${rowNumber}${row.partial ? ' | needsReview=true' : ''}`
  );

  return {
    status: 'created',
    id: camp._id,
    campId: camp.campId,
    ingestId,
    rowNumber,
    partial: row.partial,
    campDate: camp.campDate,
    startTime: camp.startTime,
  };
}

export async function processWhatsAppMessage(message) {
  if (isHelpMessage(message.text)) {
    await sendWhatsAppText(message.from, WHATSAPP_HELP_TEXT);
    return { status: 'help_sent' };
  }

  const clients = await Client.find({ isDeleted: false, isActive: true });
  const parsedCamps = parseCampMessages(message.text, { from: message.from, knownClients: clients });

  if (!parsedCamps.length) {
    await sendWhatsAppText(message.from, 'Could not read camp details. Reply HELP for the required format.');
    return { status: 'invalid', errors: ['No camp data found'] };
  }

  const createdBy = await resolveCreatedByUser(message.from);
  const submittedAt = message.timestamp
    ? new Date(Number(message.timestamp) * 1000)
    : new Date();

  const results = [];
  for (const camp of parsedCamps) {
    const result = await createCampFromWhatsAppRow({
      row: { ...camp.row, partial: camp.partial },
      rowNumber: camp.rowNumber,
      message,
      createdBy,
      submittedAt,
    });
    results.push({ ...result, partial: camp.partial, partialFields: camp.partialFields });
  }

  const replyText = buildWhatsAppAutoReply({ results });
  await sendWhatsAppText(message.from, replyText);

  const created = results.filter((item) => item.status === 'created');
  return {
    status: created.length ? 'processed' : 'no_camps_created',
    createdCount: created.length,
    results,
  };
}
