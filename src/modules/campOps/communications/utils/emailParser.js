import { parseWhatsAppMessage, validateWhatsAppCampData, WHATSAPP_FORMAT_EXAMPLE, WHATSAPP_HELP_TEXT } from './whatsappParser.js';
import { hasCampSignals } from './emailFreeformParser.js';

export { parseEmailCamps } from './emailFreeformParser.js';

const BLOCK_SEPARATOR = /(?:^|\n)\s*(?:---+|===+|\*\*\*+)\s*(?:\n|$)/;

export function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export function getEmailBodyText({ text, html }) {
  const plain = String(text || '').trim();
  if (plain) return plain;
  return stripHtmlToText(html);
}

export function splitEmailIntoCampBlocks(bodyText) {
  const text = String(bodyText || '').trim();
  if (!text) return [];

  const blocks = text
    .split(BLOCK_SEPARATOR)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length > 1) return blocks;

  return [text];
}

export function parseEmailBodyCamps(bodyText) {
  const blocks = splitEmailIntoCampBlocks(bodyText);

  return blocks.map((block, index) => {
    const parsed = parseWhatsAppMessage(block);
    const validation = validateWhatsAppCampData(parsed);
    return {
      rowNumber: index + 1,
      block,
      ...validation,
    };
  });
}

export function isHelpEmail(subject, bodyText) {
  const normalized = String(subject || '').trim().toLowerCase();
  const body = String(bodyText || '').trim().toLowerCase();
  return ['help', 'format', 'template', 'example'].includes(normalized)
    || body === 'help'
    || body === 'format';
}

export function isLikelyCampEmail({ subject, text, html, attachments = [] }) {
  const bodyText = getEmailBodyText({ text, html });

  if (isHelpEmail(subject, bodyText)) return true;

  if (attachments.some((file) => isExcelAttachment(file.filename, file.contentType))) {
    return true;
  }

  if (/client\s*[:=-]/i.test(bodyText) && /(?:camp\s*)?date\s*[:=-]/i.test(bodyText)) {
    return true;
  }

  return hasCampSignals(subject, bodyText);
}

function parseAllowList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function getSenderDomain(from) {
  const email = String(from || '').trim().toLowerCase();
  const domain = email.split('@')[1] || '';
  return domain;
}

function isAllowedSender(from) {
  const allowedEmails = parseAllowList(process.env.EMAIL_ALLOWED_SENDERS);
  const allowedDomains = parseAllowList(process.env.EMAIL_ALLOWED_DOMAINS);
  const sender = String(from || '').trim().toLowerCase();

  if (!allowedEmails.length && !allowedDomains.length) return true;

  if (allowedEmails.includes(sender)) return true;

  const senderDomain = getSenderDomain(sender);
  return allowedDomains.some((domain) => (
    senderDomain === domain || senderDomain.endsWith(`.${domain}`)
  ));
}

export function getAllowedEmailDomains() {
  return parseAllowList(process.env.EMAIL_ALLOWED_DOMAINS);
}

export function shouldProcessCampEmail(email) {
  const from = String(email.from || '').trim().toLowerCase();
  if (!isAllowedSender(from)) {
    const domains = getAllowedEmailDomains();
    const reason = domains.length
      ? `sender domain not whitelisted (${domains.join(', ')})`
      : 'sender not in EMAIL_ALLOWED_SENDERS';
    return { process: false, reason };
  }

  if (!isLikelyCampEmail(email)) {
    return { process: false, reason: 'not a camp submission (no camp/campaign signals, Client/Date, or Excel attachment)' };
  }

  return { process: true };
}

export const EMAIL_HELP_TEXT = `${WHATSAPP_HELP_TEXT}

For multiple camps in one email, separate each camp with a line containing only ---`;

export const EMAIL_FORMAT_EXAMPLE = `${WHATSAPP_FORMAT_EXAMPLE}

---
Client: Cipla
Campaign: Premium
Type: BMD
Doctor: Dr Patel
City: Pune
Date: 21/06/2026
Time: 10:00`;

export function isExcelAttachment(filename = '', contentType = '') {
  const name = String(filename).toLowerCase();
  const type = String(contentType).toLowerCase();
  return name.endsWith('.xlsx')
    || name.endsWith('.xls')
    || type.includes('spreadsheet')
    || type.includes('excel');
}
