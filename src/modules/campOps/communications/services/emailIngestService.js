import { CampOpsClient as Client, CampOpsCamp as Camp, User } from '../models.js';
import { ensureServiceUsers, ensurePendingEmailClient } from './ensureServiceUsers.js';
import { logAudit } from '../audit.adapter.js';
import { createCampFromRow } from '../campCreation.service.js';
import { CampDuplicateError } from '../utils/campDuplicateHelpers.js';
import { sendEmailReply, normalizeEmailAddress, isEmailReplyEnabled } from './emailClient.js';
import { parseExcelBuffer } from '../utils/excelParser.js';
import {
  getEmailBodyText,
  isExcelAttachment,
  isHelpEmail,
  parseEmailCamps,
  EMAIL_HELP_TEXT,
  shouldProcessCampEmail,
} from '../utils/emailParser.js';
import { PENDING_IMPORT_CLIENT_NAME } from '../utils/campMessageParser.js';
import { mapRows, suggestMappings, validateMappedRows } from '../utils/importMapper.js';
import { getMissingStandardHeaders, getStandardMapping } from '../utils/sampleExcel.js';
import { buildEmailAutoReply } from '../utils/emailReplyTemplates.js';
import { appendIngestReviewRemarks } from '../utils/ingestReviewNotes.js';
import { logIngestError } from '../utils/processSafety.js';
import { ingestWebhookEmailToInbox, syncImapMailbox } from './inboundEmailService.js';

function buildIngestId(messageId, rowNumber) {
  return `${messageId}#${rowNumber}`;
}

async function campExists(ingestId) {
  const existing = await Camp.findOne({ emailIngestId: ingestId, isDeleted: false });
  return existing || null;
}

export async function resolveCreatedByEmail(senderEmail) {
  const normalized = normalizeEmailAddress(senderEmail);
  if (normalized) {
    const mappedUser = await User.findOne({
      email: normalized,
      isActive: true,
      isDeleted: false,
    });
    if (mappedUser) return mappedUser;
  }

  const serviceEmail = (process.env.EMAIL_SERVICE_USER_EMAIL || 'email-bot@huedoraconnect.com').toLowerCase();
  let serviceUser = await User.findOne({ email: serviceEmail, isDeleted: false });
  if (!serviceUser) {
    await ensureServiceUsers();
    serviceUser = await User.findOne({ email: serviceEmail, deletedAt: null });
  }
  if (!serviceUser) {
    throw new Error(`Email service user not found (${serviceEmail}).`);
  }

  return serviceUser;
}

export async function resolveClientForEmail(row, searchText) {
  const clients = await Client.find({ isDeleted: false, isActive: true });
  const clientName = String(row.clientName || '').trim();

  if (clientName && clientName !== PENDING_IMPORT_CLIENT_NAME) {
    const exact = clients.find((client) => client.name.toLowerCase() === clientName.toLowerCase());
    if (exact) return exact;
  }

  const lower = String(searchText || '').toLowerCase();
  for (const client of clients) {
    if (lower.includes(client.name.toLowerCase())) return client;
    if (client.code && lower.includes(client.code.toLowerCase())) return client;
  }

  return ensurePendingEmailClient();
}

export async function createCampFromEmailRow({
  row,
  rowNumber,
  messageId,
  emailMeta,
  createdBy,
  submittedAt,
  skipReviewRemarks = false,
}) {
  const ingestId = buildIngestId(messageId, rowNumber);
  const existing = await campExists(ingestId);
  if (existing) {
    return { status: 'duplicate', id: existing._id, campId: existing.campId, ingestId };
  }

  const client = await resolveClientForEmail(
    row,
    `${emailMeta.subject}\n${emailMeta.rawBody}`
  );

  let camp;
  try {
    camp = await createCampFromRow({
      row: skipReviewRemarks
        ? { ...row, remarks: '' }
        : appendIngestReviewRemarks(row, client),
      client,
      createdBy,
      source: 'email',
      submittedAt,
      extras: {
        emailIngestId: ingestId,
        emailMessageId: messageId,
        emailSender: emailMeta.from,
        emailSubject: emailMeta.subject,
        emailRawBody: emailMeta.rawBody,
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

  try {
    await logAudit({
      user: createdBy,
      ip: 'email',
      entityType: 'camp',
      entityId: camp._id,
      action: 'create_email',
      afterValue: {
        campId: camp.campId,
        emailIngestId: ingestId,
        sender: emailMeta.from,
      },
    });
  } catch (auditError) {
    logIngestError('email', auditError, {
      action: 'audit',
      campId: camp.campId,
      ingestId,
    });
  }

  console.log(
    `[email] Camp created | campId=${camp.campId} | from=${emailMeta.from} | subject="${emailMeta.subject}" | row=${rowNumber}${row.partial ? ' | needsReview=true' : ''}`
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

function buildMappingForExcel(headers) {
  const standardMapping = getStandardMapping();
  const missing = getMissingStandardHeaders(headers);
  if (!missing.length) return standardMapping;

  const suggestions = suggestMappings(headers);
  return { ...standardMapping, ...suggestions };
}

async function processExcelAttachments(attachments, emailMeta, createdBy, submittedAt) {
  const excelFiles = attachments.filter((file) => isExcelAttachment(file.filename, file.contentType));
  if (!excelFiles.length) return null;

  const results = [];

  for (const [fileIndex, file] of excelFiles.entries()) {
    try {
      const parsed = parseExcelBuffer(file.content);
      const mapping = buildMappingForExcel(parsed.headers);
      const mappedRows = mapRows(parsed.rows, mapping);
      const { validRows, invalidRows } = validateMappedRows(mappedRows);

      for (const row of validRows) {
        try {
          const result = await createCampFromEmailRow({
            row,
            rowNumber: `x${fileIndex + 1}-${row.rowNumber}`,
            messageId: emailMeta.messageId,
            emailMeta,
            createdBy,
            submittedAt,
          });
          results.push(result);
        } catch (error) {
          logIngestError('email', error, {
            action: 'excel-row',
            rowNumber: `x${fileIndex + 1}-${row.rowNumber}`,
            messageId: emailMeta.messageId,
          });
          results.push({
            status: 'invalid',
            rowNumber: `x${fileIndex + 1}-${row.rowNumber}`,
            errors: [error.message],
          });
        }
      }

      invalidRows.forEach((invalid) => {
        results.push({
          status: 'invalid',
          rowNumber: `x${fileIndex + 1}-${invalid.rowNumber}`,
          errors: invalid.errors,
        });
      });
    } catch (error) {
      logIngestError('email', error, {
        action: 'excel-file',
        file: file.filename,
        messageId: emailMeta.messageId,
      });
      results.push({
        status: 'invalid',
        rowNumber: `x${fileIndex + 1}`,
        errors: [error.message],
      });
    }
  }

  return results;
}

async function processEmailBody(bodyText, emailMeta, createdBy, submittedAt) {
  const clients = await Client.find({ isDeleted: false, isActive: true });
  const parsedCamps = parseEmailCamps({
    subject: emailMeta.subject,
    bodyText,
    from: emailMeta.from,
    knownClients: clients,
  });
  const results = [];

  for (const camp of parsedCamps) {
    if (!camp.valid) {
      results.push({
        status: 'invalid',
        rowNumber: camp.rowNumber,
        errors: camp.errors,
      });
      continue;
    }

    try {
      const result = await createCampFromEmailRow({
        row: { ...camp.row, partial: camp.partial },
        rowNumber: camp.rowNumber,
        messageId: emailMeta.messageId,
        emailMeta,
        createdBy,
        submittedAt,
      });
      results.push({ ...result, partial: camp.partial, partialFields: camp.partialFields });
    } catch (error) {
      logIngestError('email', error, {
        action: 'body-row',
        rowNumber: camp.rowNumber,
        messageId: emailMeta.messageId,
      });
      results.push({
        status: 'invalid',
        rowNumber: camp.rowNumber,
        errors: [error.message],
      });
    }
  }

  return results;
}

export async function processIncomingEmail(email, channel = 'unknown') {
  try {
    return await processIncomingEmailUnsafe(email, channel);
  } catch (error) {
    const messageId = String(email?.messageId || `${Date.now()}`).trim();
    logIngestError('email', error, { action: 'process', channel, messageId });
    return {
      status: 'error',
      messageId,
      error: error.message || 'Email processing failed',
    };
  }
}

async function processIncomingEmailUnsafe(email, channel = 'unknown') {
  const from = normalizeEmailAddress(email.from);
  const subject = String(email.subject || '').trim();
  const messageId = String(email.messageId || `${Date.now()}`).trim();
  const bodyText = getEmailBodyText(email);
  const submittedAt = email.receivedAt ? new Date(email.receivedAt) : new Date();
  const attachments = email.attachments || [];
  const excelAttachments = attachments.filter((file) => isExcelAttachment(file.filename, file.contentType));
  const gate = shouldProcessCampEmail({ subject, text: email.text, html: email.html, attachments });

  if (!gate.process) {
    console.log(
      `[email] Skipped via ${channel} | from=${from} | subject="${subject}" | reason=${gate.reason}`
    );
    return { status: 'skipped', messageId, reason: gate.reason };
  }

  console.log(
    `[email] Arrived via ${channel} | from=${from} | subject="${subject}" | messageId=${messageId} | attachments=${attachments.length} | excel=${excelAttachments.length} | bodyChars=${bodyText.length}`
  );

  const emailMeta = {
    from,
    subject,
    messageId,
    rawBody: bodyText,
  };

  if (isHelpEmail(subject, bodyText)) {
    try {
      await sendEmailReply({
        to: from,
        subject: 'HueDora Connect — camp email format',
        text: EMAIL_HELP_TEXT,
      });
    } catch (error) {
      logIngestError('email', error, { action: 'help-reply', messageId, from });
    }
    return { status: 'help_sent', messageId };
  }

  const createdBy = await resolveCreatedByEmail(from);
  let results = [];

  const excelResults = await processExcelAttachments(
    attachments,
    emailMeta,
    createdBy,
    submittedAt
  );

  if (excelResults) {
    results = excelResults;
  } else if (bodyText || emailMeta.subject) {
    results = await processEmailBody(bodyText, emailMeta, createdBy, submittedAt);
  }

  const replyText = buildEmailAutoReply({
    results,
    subject,
    submittedAt,
  });

  if (isEmailReplyEnabled()) {
    try {
      await sendEmailReply({
        to: from,
        subject: `Re: ${subject || 'Camp submission'}`,
        text: replyText,
      });
    } catch (error) {
      logIngestError('email', error, { action: 'auto-reply', messageId, from });
    }
  } else {
    console.log('[email] No reply sent — EMAIL_REPLY_ENABLED=false');
  }

  const createdCount = results.filter((item) => item.status === 'created').length;
  const createdCampIds = results
    .filter((item) => item.status === 'created')
    .map((item) => item.campId);

  console.log(
    `[email] Processed ${messageId} | created=${createdCount}${createdCampIds.length ? ` | campIds=${createdCampIds.join(', ')}` : ''} | invalid=${results.filter((item) => item.status === 'invalid').length} | duplicates=${results.filter((item) => item.status === 'duplicate').length}`
  );

  return {
    status: createdCount ? 'processed' : 'no_camps_created',
    messageId,
    createdCount,
    results,
  };
}

export async function pollImapInbox() {
  return syncImapMailbox();
}
