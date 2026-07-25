import { extractCampContentFromEmailBody } from './emailBodyNormalizer.js';
import { parseCampMessageBlock,
  parseCampMessages,
  PENDING_IMPORT_CLIENT_NAME,
  matchClientFromText,
  extractDateFromText,
} from './campMessageParser.js';
import { normalizeCampName } from '../config/campNames.js';

export const PENDING_EMAIL_CLIENT_NAME = PENDING_IMPORT_CLIENT_NAME;

const CAMP_SIGNAL_PATTERN = /\b(campaign|camp\s*request|health\s*camp|screening\s*camp|screening|bmd|bone\s*health|vitamin\s*d|diabetes|kidney\s*health|dietician|calcidef|google form)\b/i;

function stripForwardedNoise(subject) {
  return String(subject || '')
    .replace(/^(?:fwd|fw|re)\s*:\s*/gi, '')
    .replace(/^\[external\]\s*/i, '')
    .trim();
}

export function hasCampSignals(subject, bodyText) {
  const combined = `${subject || ''} ${bodyText || ''}`;
  return CAMP_SIGNAL_PATTERN.test(combined);
}

function buildImportRemarks({ subject, bodyText, from, partialFields = [], rawBody = '' }) {
  const lines = [
    'Auto-imported from email — please review and complete missing fields.',
    `Sender: ${from || '-'}`,
    `Subject: ${subject || '-'}`,
  ];

  if (partialFields.length) {
    lines.push(`Auto-filled / needs review: ${partialFields.join(', ')}`);
  }

  const excerpt = String(rawBody || bodyText || '').trim().slice(0, 2000);
  if (excerpt) {
    lines.push('', '--- Original message ---', excerpt);
  }

  return lines.join('\n');
}

export function normalizeEmailCampRow(row) {
  return row;
}

export function parseFreeformEmailCamp({ subject = '', bodyText = '', from = '', knownClients = [] }) {
  const cleanSubject = stripForwardedNoise(subject);
  const { content, usedForwardExtraction } = extractCampContentFromEmailBody(bodyText, cleanSubject);
  const parseText = [cleanSubject, content].filter(Boolean).join('\n');
  const parsed = parseCampMessageBlock(parseText, { from, knownClients });

  if (!parsed.row.clientName || parsed.row.clientName === PENDING_IMPORT_CLIENT_NAME) {
    const matched = matchClientFromText(parseText, knownClients);
    if (matched) parsed.row.clientName = matched;
  }

  if (!parsed.row.campaignName || parsed.row.campaignName === 'Camp Request') {
    parsed.row.campaignName = normalizeCampName(cleanSubject || parsed.row.campaignName);
  } else {
    parsed.row.campaignName = normalizeCampName(parsed.row.campaignName);
  }

  parsed.row.remarks = buildImportRemarks({
    subject: cleanSubject,
    bodyText: content,
    from,
    partialFields: parsed.partialFields,
    rawBody: bodyText,
  });

  if (usedForwardExtraction) {
    parsed.partialFields = [...new Set([...parsed.partialFields, 'forwardExtraction'])];
    parsed.partial = true;
  }

  return parsed;
}

export function parseEmailCamps({ subject = '', bodyText = '', from = '', knownClients = [] }) {
  const cleanSubject = stripForwardedNoise(subject);
  const { content } = extractCampContentFromEmailBody(bodyText, cleanSubject);
  const combined = `${cleanSubject}\n${content}`.trim();

  const blocks = parseCampMessages(combined, { from, knownClients });
  if (blocks.length > 1) {
    return blocks.map((block) => ({
      rowNumber: block.rowNumber,
      valid: true,
      row: {
        ...block.row,
        remarks: buildImportRemarks({
          subject: cleanSubject,
          bodyText: block.rawBlock,
          from,
          partialFields: block.partialFields,
          rawBody: bodyText,
        }),
      },
      partial: block.partial,
      partialFields: block.partialFields,
    }));
  }

  const { row, partial, partialFields } = parseFreeformEmailCamp({
    subject,
    bodyText,
    from,
    knownClients,
  });

  return [{
    rowNumber: 1,
    valid: true,
    row,
    partial,
    partialFields,
  }];
}

// Re-export date helper used elsewhere
export { extractDateFromText };
