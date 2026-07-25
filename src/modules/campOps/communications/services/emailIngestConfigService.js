import { CampOpsEmailIngestConfig as EmailIngestConfig } from '../models.js';
import { getEmailBodyText, isExcelAttachment, isHelpEmail, isLikelyCampEmail } from '../utils/emailParser.js';
import { normalizeEmailAddress } from './emailClient.js';

function parseList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : String(values || '').split(/[\n,;]+/))
      .map((entry) => String(entry).trim().toLowerCase())
      .filter(Boolean)
  )];
}

function getSenderDomain(from) {
  return String(from || '').trim().toLowerCase().split('@')[1] || '';
}

function domainMatches(senderDomain, allowedDomain) {
  const domain = String(allowedDomain || '').trim().toLowerCase();
  if (!domain || !senderDomain) return false;
  return senderDomain === domain || senderDomain.endsWith(`.${domain}`);
}

function getEnvFallbackConfig() {
  return {
    allowedDomains: parseList(process.env.EMAIL_ALLOWED_DOMAINS),
    allowedSenders: parseList(process.env.EMAIL_ALLOWED_SENDERS),
    keywords: [],
  };
}

export async function getEmailIngestConfigDocument() {
  let config = await EmailIngestConfig.findOne().sort({ updatedAt: -1 });
  if (!config) {
    const fallback = getEnvFallbackConfig();
    config = await EmailIngestConfig.create({
      allowedDomains: fallback.allowedDomains,
      allowedSenders: fallback.allowedSenders,
      keywords: fallback.keywords,
    });
  }
  return config;
}

export async function getEmailIngestConfig() {
  const config = await getEmailIngestConfigDocument();
  return {
    id: config._id,
    allowedDomains: config.allowedDomains || [],
    allowedSenders: config.allowedSenders || [],
    keywords: config.keywords || [],
    updatedAt: config.updatedAt,
  };
}

export async function updateEmailIngestConfig(payload, userId) {
  const config = await getEmailIngestConfigDocument();
  config.allowedDomains = parseList(payload.allowedDomains);
  config.allowedSenders = parseList(payload.allowedSenders);
  config.keywords = parseList(payload.keywords);
  config.updatedById = userId || null;
  await config.save();

  return getEmailIngestConfig();
}

function matchesKeywords(subject, bodyText, keywords = []) {
  if (!keywords.length) return null;
  const combined = `${subject || ''} ${bodyText || ''}`.toLowerCase();
  const matched = keywords.filter((keyword) => combined.includes(String(keyword).toLowerCase()));
  return matched;
}

export function evaluateCampaignEmail(email, config) {
  const from = normalizeEmailAddress(email.from);
  const subject = String(email.subject || '').trim();
  const bodyText = getEmailBodyText(email);
  const attachments = email.attachments || [];
  const allowedDomains = parseList(config?.allowedDomains);
  const allowedSenders = parseList(config?.allowedSenders);
  const keywords = parseList(config?.keywords);
  const reasons = [];

  if (isHelpEmail(subject, bodyText)) {
    return {
      isCandidate: true,
      summary: 'Help / format request',
      reasons: ['help'],
    };
  }

  if (allowedSenders.length || allowedDomains.length) {
    const senderAllowed = allowedSenders.includes(from)
      || allowedDomains.some((domain) => domainMatches(getSenderDomain(from), domain));

    if (!senderAllowed) {
      return {
        isCandidate: false,
        summary: 'Sender not in allowed domains or email list',
        reasons: ['sender_not_allowed'],
        skipReason: 'Sender does not match configured domains or email addresses',
      };
    }
    reasons.push('sender_allowed');
  }

  if (attachments.some((file) => isExcelAttachment(file.filename, file.contentType))) {
    reasons.push('excel_attachment');
    return {
      isCandidate: true,
      summary: 'Excel camp attachment detected',
      reasons,
    };
  }

  const matchedKeywords = matchesKeywords(subject, bodyText, keywords);
  if (matchedKeywords?.length) {
    reasons.push(`keywords:${matchedKeywords.join(',')}`);
    return {
      isCandidate: true,
      summary: `Matched keywords: ${matchedKeywords.join(', ')}`,
      reasons,
    };
  }

  if (keywords.length) {
    return {
      isCandidate: false,
      summary: 'No configured keywords found in subject or body',
      reasons: ['keywords_missing'],
      skipReason: 'Email did not match any configured campaign keywords',
    };
  }

  if (isLikelyCampEmail({ subject, text: email.text, html: email.html, attachments })) {
    reasons.push('default_heuristics');
    return {
      isCandidate: true,
      summary: 'Matched default camp email signals',
      reasons,
    };
  }

  return {
    isCandidate: false,
    summary: 'No camp signals detected',
    reasons: ['no_signals'],
    skipReason: 'Email does not look like a camp submission',
  };
}
