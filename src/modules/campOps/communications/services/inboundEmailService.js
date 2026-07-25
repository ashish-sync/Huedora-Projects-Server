import { CampOpsClient as Client, CampOpsCamp as Camp, CampOpsInboundEmail as InboundEmail } from '../models.js';
import { parseExcelBuffer } from '../utils/excelParser.js';
import {
  getEmailBodyText,
  isExcelAttachment,
  parseEmailCamps,
} from '../utils/emailParser.js';
import { mapRows, suggestMappings, validateMappedRows } from '../utils/importMapper.js';
import { getMissingStandardHeaders, getStandardMapping } from '../utils/sampleExcel.js';
import { parseLocalDateInput } from '../utils/campHelpers.js';
import { parseEmailDisplaySegments } from '../utils/emailBodyNormalizer.js';
import { buildPaginationMeta, parsePaginationQuery } from '../utils/pagination.js';
import { fetchEmailsForIngest, isImapConfigured, markEmailAsSeen, normalizeEmailAddress } from './emailClient.js';
import { evaluateCampaignEmail, getEmailIngestConfig } from './emailIngestConfigService.js';
import {
  createCampFromEmailRow,
  resolveCreatedByEmail,
} from './emailIngestService.js';
import { markEmailMessageHandled } from './emailIngestSince.js';

const MAX_BODY_CHARS = 50000;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const EDITABLE_CAMP_STATUSES = ['pending_review', 'approved', 'rejected'];

function endOfDay(date) {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function parseDateFilter(value, endOfDayFlag = false) {
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = parseLocalDateInput(text) || new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return endOfDayFlag ? endOfDay(parsed) : parsed;
}

function applyReceivedAtFilter(filter, query) {
  const from = parseDateFilter(query.dateFrom);
  const to = parseDateFilter(query.dateTo, true);
  if (!from && !to) return;

  filter.receivedAt = {};
  if (from) filter.receivedAt.$gte = from;
  if (to) filter.receivedAt.$lte = to;
}

async function fetchLinkedCamps(campIds = []) {
  const uniqueIds = [...new Set((campIds || []).filter(Boolean))];
  if (!uniqueIds.length) return [];

  const camps = await Camp.find({ campId: { $in: uniqueIds }, isDeleted: false });

  return camps.map((camp) => ({
    id: camp._id,
    campId: camp.campId,
    status: camp.status,
    campaignName: camp.campaignName || '',
    clientName: camp.clientName || '',
    campDate: camp.campDate,
    editable: EDITABLE_CAMP_STATUSES.includes(camp.status),
  }));
}

function attachmentToStore(file) {
  const content = file.content;
  let stored = null;
  if (Buffer.isBuffer(content)) {
    stored = content.length <= MAX_ATTACHMENT_BYTES ? content.toString('base64') : null;
  } else if (typeof content === 'string') {
    stored = content;
  }
  return {
    filename: file.filename || 'attachment',
    contentType: file.contentType || '',
    size: content?.length || file.size || 0,
    content: stored,
    encoding: Buffer.isBuffer(content) ? 'base64' : 'utf8',
  };
}

function attachmentFromStore(file) {
  if (!file?.content) return { ...file, content: null };
  if (file.encoding === 'base64') {
    return { ...file, content: Buffer.from(file.content, 'base64') };
  }
  return file;
}

function serializeAttachments(attachments = []) {
  return attachments.map(attachmentToStore);
}

function toStoredEmailPayload(email, channel, evaluation) {
  const bodyText = getEmailBodyText(email);
  return {
    messageId: String(email.messageId || '').trim(),
    imapUid: email.uid || null,
    from: normalizeEmailAddress(email.from),
    subject: String(email.subject || '').trim(),
    bodyText: bodyText.slice(0, MAX_BODY_CHARS),
    html: String(email.html || '').slice(0, MAX_BODY_CHARS),
    receivedAt: email.receivedAt ? new Date(email.receivedAt) : new Date(),
    attachments: serializeAttachments(email.attachments),
    channel,
    isCampaignCandidate: evaluation.isCandidate,
    matchSummary: evaluation.summary || '',
    skipReason: evaluation.skipReason || '',
    status: 'inbox',
  };
}

export async function upsertInboundEmail(email, channel = 'imap') {
  const config = await getEmailIngestConfig();
  const evaluation = evaluateCampaignEmail(email, config);
  const messageId = String(email.messageId || '').trim();
  if (!messageId) {
    throw new Error('Email messageId is required');
  }

  const payload = toStoredEmailPayload(email, channel, evaluation);
  const existing = await InboundEmail.findOne({ messageId });

  if (existing?.status === 'archived') {
    return existing;
  }

  return InboundEmail.findOneAndUpdate(
    { messageId },
    {
      ...payload,
      status: existing?.status === 'processed' ? 'processed' : 'inbox',
      archivedAt: null,
      archivedBy: null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export async function syncImapMailbox(options = {}) {
  if (!isImapConfigured()) {
    throw new Error('Gmail/IMAP is not configured. Set EMAIL_IMAP_* variables in server .env');
  }

  const dateFrom = parseDateFilter(options.dateFrom);
  const dateTo = parseDateFilter(options.dateTo, true);

  const emails = await fetchEmailsForIngest();
  const synced = [];
  const errors = [];

  for (const email of emails) {
    const receivedAt = email.receivedAt ? new Date(email.receivedAt) : new Date();
    if (dateFrom && receivedAt < dateFrom) continue;
    if (dateTo && receivedAt > dateTo) continue;

    try {
      const stored = await upsertInboundEmail(email, 'imap');
      synced.push(stored);
    } catch (error) {
      console.error(`[email] Failed to store message ${email.messageId || email.uid}:`, error.message);
      errors.push({
        messageId: email.messageId || null,
        uid: email.uid || null,
        error: error.message,
      });
    }
  }

  return {
    fetched: emails.length,
    synced: synced.length,
    filtered: emails.length - synced.length - errors.length,
    failed: errors.length,
    errors,
    mailbox: process.env.EMAIL_IMAP_MAILBOX || 'INBOX',
    mailboxUser: process.env.EMAIL_IMAP_USER || '',
    dateFrom: dateFrom?.toISOString() || null,
    dateTo: dateTo?.toISOString() || null,
  };
}

export async function listInboundEmails(query = {}) {
  const { page, limit, skip } = parsePaginationQuery(query);
  const filter = {};

  if (query.status === 'archived') {
    filter.status = 'archived';
  } else {
    filter.status = { $in: ['inbox', 'processed'] };
  }

  if (query.candidate === '1' || query.candidate === 'true') {
    filter.isCampaignCandidate = true;
  } else if (query.candidate === '0' || query.candidate === 'false') {
    filter.isCampaignCandidate = false;
  }

  const extraClauses = [];
  if (query.camps === 'created') {
    extraClauses.push({ linkedCampIds: { $exists: true, $not: { $size: 0 } } });
  } else if (query.camps === 'none') {
    extraClauses.push({
      $or: [
        { linkedCampIds: { $exists: false } },
        { linkedCampIds: { $size: 0 } },
      ],
    });
  }

  applyReceivedAtFilter(filter, query);

  if (query.search) {
    const regex = new RegExp(String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    extraClauses.push({ $or: [{ from: regex }, { subject: regex }, { bodyText: regex }] });
  }

  if (extraClauses.length === 1) {
    Object.assign(filter, extraClauses[0]);
  } else if (extraClauses.length > 1) {
    filter.$and = extraClauses;
  }

  const [data, total] = await Promise.all([
    InboundEmail.find(filter).sort({ receivedAt: -1 }).skip(skip).limit(limit),
    InboundEmail.countDocuments(filter),
  ]);

  const linkedByMessage = await Promise.all(
    data.map(async (record) => ({
      id: record._id,
      linkedCamps: await fetchLinkedCamps(record.linkedCampIds),
    }))
  );
  const linkedMap = new Map(linkedByMessage.map((item) => [String(item.id), item.linkedCamps]));

  return {
    data: data.map((record) => serializeInboundEmailListItem(record, linkedMap.get(String(record._id)) || [])),
    pagination: buildPaginationMeta(page, limit, total),
  };
}

function serializeInboundEmailListItem(record, linkedCamps = []) {
  return {
    id: record._id,
    messageId: record.messageId,
    from: record.from,
    subject: record.subject,
    receivedAt: record.receivedAt,
    status: record.status,
    isCampaignCandidate: record.isCampaignCandidate,
    matchSummary: record.matchSummary,
    skipReason: record.skipReason,
    channel: record.channel,
    attachmentCount: record.attachments?.length || 0,
    linkedCampIds: record.linkedCampIds || [],
    linkedCamps,
    previewReady: Boolean(record.previewData),
    processedAt: record.processedAt,
    archivedAt: record.archivedAt,
    hasLinkedCamps: (record.linkedCampIds || []).length > 0,
  };
}

export async function getInboundEmailById(id) {
  const record = await InboundEmail.findById(id);
  if (!record) return null;

  const linkedCamps = await fetchLinkedCamps(record.linkedCampIds);
  const bodySegments = parseEmailDisplaySegments(record.bodyText);

  return {
    id: record._id,
    messageId: record.messageId,
    from: record.from,
    subject: record.subject,
    bodyText: record.bodyText,
    bodySegments,
    html: record.html,
    receivedAt: record.receivedAt,
    status: record.status,
    isCampaignCandidate: record.isCampaignCandidate,
    matchSummary: record.matchSummary,
    skipReason: record.skipReason,
    channel: record.channel,
    attachments: (record.attachments || []).map((file) => ({
      filename: file.filename,
      contentType: file.contentType,
      size: file.size,
      hasContent: Boolean(file.content),
    })),
    linkedCampIds: record.linkedCampIds || [],
    linkedCamps,
    previewData: record.previewData,
    processedAt: record.processedAt,
    archivedAt: record.archivedAt,
  };
}

function buildMappingForExcel(headers) {
  const standardMapping = getStandardMapping();
  const missing = getMissingStandardHeaders(headers);
  if (!missing.length) return standardMapping;
  const suggestions = suggestMappings(headers);
  return { ...standardMapping, ...suggestions };
}

async function extractExcelPreview(attachments) {
  const excelFiles = attachments
    .map(attachmentFromStore)
    .filter((file) => isExcelAttachment(file.filename, file.contentType) && file.content);
  if (!excelFiles.length) return null;

  const previews = [];
  for (const [fileIndex, file] of excelFiles.entries()) {
    const parsed = parseExcelBuffer(file.content);
    const mapping = buildMappingForExcel(parsed.headers);
    const mappedRows = mapRows(parsed.rows, mapping);
    const { validRows, invalidRows } = validateMappedRows(mappedRows);

    previews.push({
      source: 'excel',
      fileName: file.filename,
      sheetName: parsed.sheetName,
      totalRows: parsed.rows.length,
      validRows,
      invalidRows,
      mapping,
    });
  }

  return previews;
}

async function extractBodyPreview(record) {
  const clients = await Client.find({ isDeleted: false, isActive: true });
  const parsedCamps = parseEmailCamps({
    subject: record.subject,
    bodyText: record.bodyText,
    from: record.from,
    knownClients: clients,
  });

  return parsedCamps.map((camp) => ({
    rowNumber: camp.rowNumber,
    valid: camp.valid,
    partial: camp.partial,
    partialFields: camp.partialFields || [],
    errors: camp.errors || [],
    row: camp.row || null,
    block: camp.block || '',
  }));
}

export async function extractInboundEmailPreview(id, { force = false } = {}) {
  const record = await InboundEmail.findById(id);
  if (!record) {
    throw new Error('Email not found');
  }

  if (record.previewData && !force) {
    return record.previewData;
  }

  let excelPreview = await extractExcelPreview(record.attachments || []);
  let bodyPreview = [];

  if (!excelPreview?.length) {
    bodyPreview = await extractBodyPreview(record);
  }

  const previewData = {
    extractedAt: new Date(),
    excelPreview,
    bodyPreview,
    summary: {
      excelFiles: excelPreview?.length || 0,
      validBodyRows: bodyPreview.filter((row) => row.valid).length,
      invalidBodyRows: bodyPreview.filter((row) => !row.valid).length,
    },
  };

  record.previewData = previewData;
  await record.save();

  return previewData;
}

export async function saveInboundEmailPreview(id, previewData) {
  const record = await InboundEmail.findById(id);
  if (!record) {
    throw new Error('Email not found');
  }

  record.previewData = {
    ...previewData,
    updatedAt: new Date(),
  };
  await record.save();
  return record.previewData;
}

export async function processInboundEmailRecord(id, user, options = {}) {
  const record = await InboundEmail.findById(id);
  if (!record) {
    throw new Error('Email not found');
  }

  if (record.status === 'archived') {
    throw new Error('Archived emails cannot be processed');
  }

  if (options.previewData) {
    record.previewData = options.previewData;
    await record.save();
  }

  const preview = record.previewData || await extractInboundEmailPreview(id);
  const createdBy = await resolveCreatedByEmail(record.from);
  const submittedAt = record.receivedAt || new Date();
  const emailMeta = {
    from: record.from,
    subject: record.subject,
    messageId: record.messageId,
    rawBody: record.bodyText,
  };

  const results = [];

  if (preview.excelPreview?.length) {
    for (const filePreview of preview.excelPreview) {
      for (const row of filePreview.validRows) {
        try {
          const result = await createCampFromEmailRow({
            row,
            rowNumber: row.rowNumber,
            messageId: record.messageId,
            emailMeta,
            createdBy: user || createdBy,
            submittedAt,
          });
          results.push(result);
        } catch (error) {
          results.push({
            status: 'invalid',
            rowNumber: row.rowNumber,
            errors: [error.message],
          });
        }
      }

      filePreview.invalidRows.forEach((invalid) => {
        results.push({
          status: 'invalid',
          rowNumber: invalid.rowNumber,
          errors: invalid.errors,
        });
      });
    }
  } else if (preview.bodyPreview?.length) {
    for (const camp of preview.bodyPreview) {
      if (!camp.valid || !camp.row) {
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
          messageId: record.messageId,
          emailMeta,
          createdBy: user || createdBy,
          submittedAt,
        });
        results.push(result);
      } catch (error) {
        results.push({
          status: 'invalid',
          rowNumber: camp.rowNumber,
          errors: [error.message],
        });
      }
    }
  } else {
    throw new Error('No extractable camp data found. Run extract preview first.');
  }

  const createdCampIds = results
    .filter((item) => item.status === 'created')
    .map((item) => item.campId);

  record.status = 'processed';
  record.processedAt = new Date();
  record.processedById = user?._id || user?.id || null;
  record.linkedCampIds = [...new Set([...(record.linkedCampIds || []), ...createdCampIds])];
  await record.save();

  if (record.imapUid) {
    markEmailMessageHandled({
      messageId: record.messageId,
      receivedAt: record.receivedAt,
      uid: record.imapUid,
    });
    await markEmailAsSeen(record.imapUid);
  }

  return {
    created: createdCampIds.length,
    campIds: createdCampIds,
    results,
  };
}

export async function archiveInboundEmailRecord(id, user) {
  const record = await InboundEmail.findById(id);
  if (!record) {
    throw new Error('Email not found');
  }

  record.status = 'archived';
  record.archivedAt = new Date();
  record.archivedById = user?._id || user?.id || null;
  await record.save();

  if (record.imapUid) {
    markEmailMessageHandled({
      messageId: record.messageId,
      receivedAt: record.receivedAt,
      uid: record.imapUid,
    });
    await markEmailAsSeen(record.imapUid);
  }

  return serializeInboundEmailListItem(record);
}

export async function restoreInboundEmailRecord(id) {
  const record = await InboundEmail.findById(id);
  if (!record) {
    throw new Error('Email not found');
  }

  if (record.status !== 'archived') {
    throw new Error('Only archived emails can be restored');
  }

  record.status = (record.linkedCampIds || []).length > 0 ? 'processed' : 'inbox';
  record.archivedAt = null;
  record.archivedById = null;
  await record.save();

  return serializeInboundEmailListItem(record, await fetchLinkedCamps(record.linkedCampIds));
}

export async function ingestWebhookEmailToInbox(email) {
  const stored = await upsertInboundEmail(email, 'webhook');
  return stored;
}

export async function getCommunicationsEmailStatus() {
  return {
    imapConfigured: isImapConfigured(),
    mailbox: process.env.EMAIL_IMAP_MAILBOX || 'INBOX',
    mailboxUser: process.env.EMAIL_IMAP_USER || '',
    inboxCount: await InboundEmail.countDocuments({ status: { $in: ['inbox', 'processed'] } }),
    archivedCount: await InboundEmail.countDocuments({ status: 'archived' }),
    processedCount: await InboundEmail.countDocuments({ status: 'processed' }),
  };
}
