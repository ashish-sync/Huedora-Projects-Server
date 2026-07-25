import { AppError } from '../../utils/helpers.js';
import {
  archiveInboundEmailRecord,
  extractInboundEmailPreview,
  getCommunicationsEmailStatus,
  getInboundEmailById,
  listInboundEmails,
  processInboundEmailRecord,
  restoreInboundEmailRecord,
  saveInboundEmailPreview,
  syncImapMailbox,
} from './communications/services/inboundEmailService.js';
import {
  getEmailIngestConfig,
  updateEmailIngestConfig,
} from './communications/services/emailIngestConfigService.js';
import { isImapConfigured } from './communications/services/emailClient.js';

function toActor(user) {
  if (!user) return null;
  return { _id: user._id, id: user._id, email: user.email };
}

export async function handleEmailStatus(_req, res) {
  const status = await getCommunicationsEmailStatus();
  res.json({
    data: {
      configured: status.imapConfigured,
      connected: status.imapConfigured,
      imapConfigured: status.imapConfigured,
      lastSyncAt: null,
      pendingMessages: status.inboxCount || 0,
      ...status,
    },
  });
}

export async function handleEmailConfigGet(_req, res) {
  const data = await getEmailIngestConfig();
  res.json({
    data: {
      ...data,
      enabled: isImapConfigured(),
      host: process.env.EMAIL_IMAP_HOST || '',
      port: Number(process.env.EMAIL_IMAP_PORT || 993),
      user: process.env.EMAIL_IMAP_USER || '',
      mailbox: process.env.EMAIL_IMAP_MAILBOX || 'INBOX',
      configured: isImapConfigured(),
    },
  });
}

export async function handleEmailConfigPut(req, res) {
  const data = await updateEmailIngestConfig(req.body, req.user?._id);
  res.json({ data });
}

export async function handleEmailSync(req, res) {
  const data = await syncImapMailbox({
    dateFrom: req.body?.dateFrom,
    dateTo: req.body?.dateTo,
  });
  res.json({ data });
}

export async function handleEmailMessagesList(req, res) {
  const result = await listInboundEmails(req.query);
  res.json({
    data: result.data,
    meta: result.pagination,
    pagination: result.pagination,
  });
}

export async function handleEmailMessageGet(req, res) {
  const data = await getInboundEmailById(req.params.id);
  if (!data) throw new AppError('Email message not found', 404, 'NOT_FOUND');
  res.json({ data });
}

export async function handleEmailExtract(req, res) {
  const force = req.body?.force === true || req.query?.force === 'true';
  const data = await extractInboundEmailPreview(req.params.id, { force });
  res.json({ data });
}

export async function handleEmailPreviewSave(req, res) {
  const data = await saveInboundEmailPreview(req.params.id, req.body?.previewData);
  res.json({ data });
}

export async function handleEmailProcess(req, res) {
  const data = await processInboundEmailRecord(req.params.id, toActor(req.user), {
    previewData: req.body?.previewData,
  });
  res.json({ data });
}

export async function handleEmailArchive(req, res) {
  const data = await archiveInboundEmailRecord(req.params.id, toActor(req.user));
  res.json({ data });
}

export async function handleEmailRestore(req, res) {
  const data = await restoreInboundEmailRecord(req.params.id);
  res.json({ data });
}
