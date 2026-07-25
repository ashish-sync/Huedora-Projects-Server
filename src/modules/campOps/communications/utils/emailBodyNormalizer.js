import { scoreCampTextSegment } from './campFieldExtractors.js';
import { splitCampMessageBlocks } from './campMessageParser.js';

const FORWARD_SPLIT_PATTERNS = [
  /(?:^|\n)-{3,}\s*Forwarded message\s*-{3,}/gi,
  /(?:^|\n)-{3,}\s*Original Message\s*-{3,}/gi,
  /(?:^|\n)Begin forwarded message:?/gi,
  /(?:^|\n)_{5,}/g,
  /(?:^|\n)On .{10,120} wrote:\s*\n/gi,
];

const NOISE_LINE_PATTERNS = [
  /^from:\s*.+$/i,
  /^to:\s*.+$/i,
  /^cc:\s*.+$/i,
  /^sent:\s*.+$/i,
  /^subject:\s*.+$/i,
  /^date:\s*.+$/i,
  /^reply-to:\s*.+$/i,
  /^>{1,}\s*.+$/,
  /^confidential/i,
  /^disclaimer/i,
  /^this email/i,
  /^please consider the environment/i,
  /^google form uploaded/i,
];

const HEADER_LINE_PATTERNS = [
  /^from:\s*.+$/i,
  /^to:\s*.+$/i,
  /^cc:\s*.+$/i,
  /^sent:\s*.+$/i,
  /^subject:\s*.+$/i,
  /^date:\s*.+$/i,
  /^reply-to:\s*.+$/i,
];

function normalizeLine(line = '') {
  return String(line).replace(/^>\s?/, '').trim();
}

function extractSegmentMeta(text = '') {
  const meta = { from: '', subject: '', date: '' };
  const lines = String(text || '').split(/\r?\n/);

  lines.slice(0, 14).forEach((line) => {
    const trimmed = normalizeLine(line);
    if (!trimmed) return;

    const fromMatch = /^from:\s*(.+)$/i.exec(trimmed);
    const subjectMatch = /^subject:\s*(.+)$/i.exec(trimmed);
    const dateMatch = /^(?:date|sent):\s*(.+)$/i.exec(trimmed);

    if (fromMatch && !meta.from) meta.from = fromMatch[1].trim();
    if (subjectMatch && !meta.subject) meta.subject = subjectMatch[1].trim();
    if (dateMatch && !meta.date) meta.date = dateMatch[1].trim();
  });

  return meta;
}

function formatDisplayText(text = '') {
  const lines = String(text || '').split(/\r?\n/);
  const formatted = lines
    .map((line) => {
      const trimmed = line.trimEnd();
      if (/^>\s?/.test(trimmed)) {
        return trimmed.replace(/^>\s?/, '');
      }
      return trimmed;
    })
    .filter((line, index, allLines) => {
      const trimmed = line.trim();
      if (!trimmed) return true;

      const isHeader = HEADER_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
      if (!isHeader) return true;

      const headerLinesBefore = allLines.slice(0, index).filter((entry) => entry.trim()).length;
      return headerLinesBefore > 8;
    });

  return formatted
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildPreviewLine(text = '', meta = {}) {
  if (meta.subject) return meta.subject;
  const firstContentLine = String(text || '')
    .split(/\r?\n/)
    .map(normalizeLine)
    .find((line) => line && !HEADER_LINE_PATTERNS.some((pattern) => pattern.test(line)));
  if (!firstContentLine) return 'No preview available';
  return firstContentLine.length > 140 ? `${firstContentLine.slice(0, 140)}…` : firstContentLine;
}

function stripNoiseLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      return !NOISE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitForwardChain(text) {
  let segments = [String(text || '')];

  FORWARD_SPLIT_PATTERNS.forEach((pattern) => {
    const next = [];
    segments.forEach((segment) => {
      segment.split(pattern).forEach((part) => {
        const cleaned = part.trim();
        if (cleaned) next.push(cleaned);
      });
    });
    segments = next;
  });

  return segments.length ? segments : [String(text || '')];
}

export function parseEmailDisplaySegments(bodyText) {
  const raw = String(bodyText || '').trim();
  if (!raw) return [];

  const parts = splitForwardChain(raw).filter(Boolean);
  if (!parts.length) {
    const meta = extractSegmentMeta(raw);
    return [{
      index: 1,
      label: 'Message',
      text: formatDisplayText(raw) || raw,
      preview: buildPreviewLine(raw, meta),
      meta,
      isForwarded: false,
    }];
  }

  return parts.map((part, index) => {
    const meta = extractSegmentMeta(part);
    const text = formatDisplayText(part) || part.trim();
    return {
      index: index + 1,
      label: index === 0 ? 'Latest message' : `Forwarded message ${index}`,
      text,
      preview: buildPreviewLine(text, meta),
      meta,
      isForwarded: index > 0,
    };
  });
}

export function extractCampContentFromEmailBody(bodyText, subject = '') {
  const raw = String(bodyText || '').trim();
  if (!raw) {
    return { content: '', segmentCount: 0, usedForwardExtraction: false };
  }

  const forwardSegments = splitForwardChain(raw).map(stripNoiseLines).filter(Boolean);
  const candidateSegments = forwardSegments.length > 1 ? forwardSegments : [stripNoiseLines(raw)];

  const scored = candidateSegments
    .map((segment, index) => ({
      segment,
      index,
      score: scoreCampTextSegment(segment) + (/\bcamp\b/i.test(subject) ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score || b.index - a.index);

  const best = scored[0];
  if (best?.score > 0) {
    return {
      content: best.segment,
      segmentCount: candidateSegments.length,
      usedForwardExtraction: candidateSegments.length > 1,
    };
  }

  const blocks = splitCampMessageBlocks(raw);
  return {
    content: blocks[0] || raw,
    segmentCount: blocks.length,
    usedForwardExtraction: false,
  };
}
