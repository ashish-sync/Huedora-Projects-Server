import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { getAllowedEmailDomains } from '../utils/emailParser.js';
import { buildImapFetchQuery, describeImapFetchQuery, logEmailProcessSince } from './emailIngestSince.js';

export function isEmailReplyConfigured() {
  return Boolean(
    process.env.EMAIL_SMTP_HOST
    && process.env.EMAIL_SMTP_FROM
  );
}

export function isEmailReplyEnabled() {
  return process.env.EMAIL_REPLY_ENABLED !== 'false';
}

export function isImapConfigured() {
  return Boolean(
    process.env.EMAIL_IMAP_HOST
    && process.env.EMAIL_IMAP_USER
    && process.env.EMAIL_IMAP_PASSWORD
  );
}

function createImapClient() {
  return new ImapFlow({
    host: process.env.EMAIL_IMAP_HOST,
    port: Number(process.env.EMAIL_IMAP_PORT || 993),
    secure: process.env.EMAIL_IMAP_TLS !== 'false',
    logger: false,
    auth: {
      user: process.env.EMAIL_IMAP_USER,
      pass: process.env.EMAIL_IMAP_PASSWORD,
    },
  });
}

export function formatImapError(error) {
  if (error?.authenticationFailed || error?.serverResponseCode === 'AUTHENTICATIONFAILED') {
    return 'Gmail rejected login — use a Google App Password (not your normal password). Enable 2-Step Verification, then create an app password at https://myaccount.google.com/apppasswords and set EMAIL_IMAP_PASSWORD in .env';
  }

  if (error?.responseText) {
    return error.responseText;
  }

  return error?.message || 'Unknown IMAP error';
}

export function logEmailIngestStartup() {
  const webhookUrl = process.env.EMAIL_WEBHOOK_URL || '/api/ingest/email/webhook';
  console.log(`[email] Webhook ingest ready at ${webhookUrl}`);

  if (isEmailReplyEnabled() && isEmailReplyConfigured()) {
    console.log(`[email] SMTP replies enabled from ${process.env.EMAIL_SMTP_FROM}`);
  } else if (!isEmailReplyEnabled()) {
    console.log('[email] SMTP replies disabled — EMAIL_REPLY_ENABLED=false');
  } else {
    console.log('[email] SMTP replies not configured (confirmation emails disabled)');
  }

  if (process.env.EMAIL_IMAP_ENABLED !== 'true') {
    console.log('[email] IMAP polling disabled — set EMAIL_IMAP_ENABLED=true to auto-read mailbox');
    return;
  }

  if (!isImapConfigured()) {
    console.warn('[email] IMAP enabled but missing EMAIL_IMAP_HOST, EMAIL_IMAP_USER, or EMAIL_IMAP_PASSWORD');
  } else {
    const domains = getAllowedEmailDomains();
    if (domains.length) {
      console.log(`[email] Sender domain whitelist: ${domains.join(', ')}`);
    } else {
      console.log('[email] No sender domain whitelist — set EMAIL_ALLOWED_DOMAINS to restrict senders');
    }
    logEmailProcessSince();
  }
}

export async function verifyImapConnection() {
  if (!isImapConfigured()) {
    throw new Error('IMAP is not configured');
  }

  const mailbox = process.env.EMAIL_IMAP_MAILBOX || 'INBOX';
  const client = createImapClient();

  await client.connect();
  const lock = await client.getMailboxLock(mailbox);

  try {
    const status = client.mailbox || {};
    const exists = status.exists ?? 0;
    const unseen = status.unseen ?? 0;

    console.log(
      `[email] IMAP connected and ready | host=${process.env.EMAIL_IMAP_HOST} | user=${process.env.EMAIL_IMAP_USER} | mailbox=${mailbox} | total=${exists} | unread=${unseen} | watching for new mail`
    );

    return { mailbox, exists, unseen };
  } finally {
    lock.release();
    await client.logout();
  }
}

export function normalizeEmailAddress(value) {
  const text = String(value || '').trim();
  const match = /<([^>]+)>/.exec(text) || /^[^\s<]+@[^\s>]+$/.exec(text);
  return (match?.[1] || match?.[0] || text).trim().toLowerCase();
}

function getSmtpTransport() {
  const port = Number(process.env.EMAIL_SMTP_PORT || 587);
  const secure = process.env.EMAIL_SMTP_SECURE === 'true' || port === 465;

  return nodemailer.createTransport({
    host: process.env.EMAIL_SMTP_HOST,
    port,
    secure,
    auth: process.env.EMAIL_SMTP_USER
      ? {
          user: process.env.EMAIL_SMTP_USER,
          pass: process.env.EMAIL_SMTP_PASSWORD,
        }
      : undefined,
  });
}

export async function sendTransactionalEmail({ to, subject, text, html }) {
  if (!isEmailReplyEnabled()) {
    console.log('[email] Transactional email skipped — EMAIL_REPLY_ENABLED=false');
    return null;
  }

  if (!isEmailReplyConfigured()) {
    console.log('[email] Transactional email skipped — SMTP not configured');
    return null;
  }

  const transport = getSmtpTransport();
  const info = await transport.sendMail({
    from: process.env.EMAIL_SMTP_FROM,
    to,
    subject,
    text,
    html,
  });

  console.log(`[email] Transactional email sent | to=${to} | subject="${subject}"`);
  return info;
}

export async function sendEmailReply({ to, subject, text }) {
  return sendTransactionalEmail({ to, subject, text });
}

export async function parseRawEmail(buffer) {
  const parsed = await simpleParser(buffer);
  return normalizeParsedEmail(parsed);
}

export function normalizeParsedEmail(parsed) {
  const attachments = (parsed.attachments || []).map((attachment) => ({
    filename: attachment.filename || 'attachment',
    contentType: attachment.contentType || '',
    content: attachment.content,
  }));

  return {
    from: normalizeEmailAddress(parsed.from?.text || parsed.from?.value?.[0]?.address || ''),
    subject: String(parsed.subject || '').trim(),
    messageId: String(parsed.messageId || `${Date.now()}-${Math.random()}`).trim(),
    text: parsed.text || '',
    html: parsed.html || '',
    receivedAt: parsed.date || new Date(),
    attachments,
  };
}

let imapOperationChain = Promise.resolve();

function runExclusiveImapOperation(operationName, fn) {
  const run = imapOperationChain.then(async () => {
    try {
      return await fn();
    } catch (error) {
      const wrapped = new Error(formatImapError(error));
      wrapped.cause = error;
      console.error(`[email] ${operationName} failed:`, wrapped.message);
      throw wrapped;
    }
  });

  imapOperationChain = run.catch(() => {});
  return run;
}

export async function fetchEmailsForIngest() {
  if (!isImapConfigured()) {
    throw new Error('IMAP is not configured');
  }

  return runExclusiveImapOperation('IMAP fetch', async () => {
    const client = createImapClient();
    const mailbox = process.env.EMAIL_IMAP_MAILBOX || 'INBOX';
    const emails = [];

    await client.connect();
    const lock = await client.getMailboxLock(mailbox);

    try {
      const fetchQuery = buildImapFetchQuery();
      const messages = await client.fetch(
        fetchQuery,
        { uid: true, source: true, envelope: true, internalDate: true }
      );

      for await (const message of messages) {
        try {
          const parsed = await simpleParser(message.source);
          const normalized = normalizeParsedEmail(parsed);
          emails.push({
            uid: message.uid,
            internalDate: message.internalDate,
            receivedAt: normalized.receivedAt || message.internalDate || new Date(),
            ...normalized,
          });
        } catch (error) {
          console.error(`[email] Failed to parse IMAP message uid=${message.uid}:`, error.message);
        }
      }
    } finally {
      lock.release();
      await client.logout();
    }

    emails.sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt));

    if (emails.length) {
      console.log(`[email] IMAP fetched ${emails.length} message(s) since cursor (read + unread)`);
    }

    return emails;
  });
}

/** @deprecated use fetchEmailsForIngest */
export async function fetchUnreadEmails() {
  return fetchEmailsForIngest();
}

export async function markEmailAsSeen(uid) {
  if (!isImapConfigured()) return;

  return runExclusiveImapOperation('IMAP mark seen', async () => {
    const client = createImapClient();
    const mailbox = process.env.EMAIL_IMAP_MAILBOX || 'INBOX';

    await client.connect();
    const lock = await client.getMailboxLock(mailbox);

    try {
      await client.messageFlagsAdd({ uid }, ['\\Seen']);
    } finally {
      lock.release();
      await client.logout();
    }
  });
}
