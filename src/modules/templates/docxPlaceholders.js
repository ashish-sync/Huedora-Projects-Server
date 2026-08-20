import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import { formatDate } from '../../utils/dateFormat.js';
import {
  remapLineRowsToLiveTables,
  rewriteServiceAgreementLineTableXml,
  normalizeDetectedLineColumns,
} from './serviceAgreementLineTable.js';
import { repackDocxDocumentXml } from './repackDocx.js';

export { repackDocxDocumentXml } from './repackDocx.js';

/** Any [content] bracket is a merge field. Types: name | number | alphanumeric | date | text */
export const PLACEHOLDER_REGEX = /\[([^\]]+)\]/g;

const TYPE_ALIASES = {
  name: 'name',
  number: 'number',
  numeric: 'number',
  alphanumeric: 'alphanumeric',
  alphanum: 'alphanumeric',
  'alpha-numeric': 'alphanumeric',
  'alpha numeric': 'alphanumeric',
  date: 'date',
};

/** Field tokens whose label implies a calendar date (Todays Date, Effective Date, …). */
export function isDateFieldToken(inner = '') {
  const cleaned = String(inner)
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\s+/g, ' ');
  if (!cleaned) return false;
  if (TYPE_ALIASES[cleaned] === 'date' || /^date(\s*\d+)?$/.test(cleaned)) return true;
  if (/\btodays?\s*date\b/.test(cleaned)) return true;
  if (/\beffective\s*date\b/.test(cleaned)) return true;
  if (/\b(start|end|issue|expiry|expiration|camp|agreement|po|wo)\s*date\b/.test(cleaned)) {
    return true;
  }
  return /\bdates?\b/.test(cleaned) || /\bdated\b/.test(cleaned);
}

export function normalizePlaceholderType(inner = '') {
  const cleaned = String(inner).trim().toLowerCase().replace(/\s+/g, ' ');
  if (TYPE_ALIASES[cleaned]) return TYPE_ALIASES[cleaned];
  if (/^name(\s*\d+)?$/.test(cleaned)) return 'name';
  if (/^number(\s*\d+)?$/.test(cleaned)) return 'number';
  if (/^alpha[\s-]?num(eric)?(\s*\d+)?$/.test(cleaned)) return 'alphanumeric';
  if (isDateFieldToken(inner)) return 'date';
  return 'text';
}

export function placeholderLabel(inner, type, occurrence) {
  const base =
    type === 'name'
      ? 'Name'
      : type === 'number'
        ? 'Number'
        : type === 'alphanumeric'
          ? 'Alphanumeric'
          : type === 'date'
            ? (String(inner).trim().replace(/\s+/g, ' ') || 'Date')
            : String(inner).trim().replace(/\s+/g, ' ') || 'Field';
  return occurrence > 1 ? `${base} (${occurrence})` : base;
}

export function validatePlaceholderValue(type, value) {
  const v = String(value ?? '').trim();
  if (!v) return 'This field is required';
  if (type === 'name' && !/^[A-Za-z][A-Za-z .'-]*$/.test(v)) {
    return 'Enter a name using letters only';
  }
  if (type === 'number' && !/^[0-9]+([.,][0-9]+)?$/.test(v)) {
    return 'Enter a number';
  }
  if (type === 'alphanumeric' && !/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(v)) {
    return 'Enter letters and numbers only';
  }
  if (type === 'date') {
    const formatted = formatDate(v);
    if (!formatted || formatted === '-') return 'Enter a valid date';
  }
  return null;
}

function formatMergeValue(ph, value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (ph?.type === 'date' || isDateFieldToken(ph?.inner || ph?.label || '')) {
    const formatted = formatDate(raw);
    return formatted && formatted !== '-' ? formatted : raw;
  }
  return raw;
}

export function extractPlaceholdersFromText(text = '') {
  const found = [];
  const counts = Object.create(null);
  const re = new RegExp(PLACEHOLDER_REGEX.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1].trim().replace(/\s+/g, ' ');
    if (!inner) continue;
    const type = normalizePlaceholderType(inner);
    const token = `[${inner}]`;
    const countKey =
      type === 'text' || type === 'date'
        ? `${type}:${inner.toLowerCase()}`
        : type;
    counts[countKey] = (counts[countKey] || 0) + 1;
    const occurrence = counts[countKey];

    let key;
    if (type === 'text' || type === 'date') {
      const base =
        inner.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') ||
        `field_${found.length + 1}`;
      key = occurrence === 1 ? base : `${base}_${occurrence}`;
    } else {
      key = occurrence === 1 ? type : `${type}_${occurrence}`;
    }

    found.push({
      key,
      label: placeholderLabel(inner, type, occurrence),
      type,
      token,
      occurrence,
      inner,
    });
  }
  return found;
}

export function fillTextPlaceholders(text = '', values = {}, placeholders = null) {
  const list = placeholders || extractPlaceholdersFromText(text);
  let out = String(text);

  // Replace each occurrence in document order (supports duplicate [name] fields)
  for (const ph of list) {
    const value = values[ph.key] ?? values[ph.token] ?? values[ph.inner];
    if (value == null || String(value).trim() === '') continue;
    const display = formatMergeValue(ph, value);
    const idx = out.indexOf(ph.token);
    if (idx === -1) {
      // Case-insensitive fallback for token
      const soft = new RegExp(escapeRegex(ph.token), 'i');
      out = out.replace(soft, display);
    } else {
      out = out.slice(0, idx) + display + out.slice(idx + ph.token.length);
    }
  }

  return out;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Allow optional XML markup between each character of the placeholder (Word splits runs). */
function xmlSoftPattern(token) {
  return token
    .split('')
    .map((ch) => escapeRegex(escapeXml(ch)))
    .join('(?:<[^>]+>)*');
}

export async function readDocxBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Invalid Word file: missing document.xml');
  const xml = await docFile.async('string');
  const plain = xmlFragmentToPlain(xml);
  return { zip, xml, plain };
}

function decodeXmlEntities(s = '') {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Extract readable text from a Word XML fragment (paragraph, cell, etc.). */
export function xmlFragmentToPlain(xml = '') {
  return decodeXmlEntities(
    String(xml)
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^/]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:t[^>]*>/g, '')
      .replace(/<\/w:t>/g, '')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function cellPlain(tcXml = '') {
  return xmlFragmentToPlain(tcXml).replace(/\n+/g, ' ').trim();
}

export async function parseDocxBufferBlocks(buffer) {
  const { xml, plain, zip } = await readDocxBuffer(buffer);
  const images = await loadDocxImageMap(zip);
  const blocks = parseDocxBlocks(xml, images);
  return { zip, xml, plain, blocks: blocks.length ? blocks : [{ type: 'p', text: plain }] };
}

export async function analyzeDocx(buffer) {
  const read = await readDocxBuffer(buffer);
  const xml = rewriteServiceAgreementLineTableXml(read.xml);
  const plain = xml === read.xml ? read.plain : xmlFragmentToPlain(xml);
  const repeatableTables = detectRepeatableTables(xml);
  const rowTokens = new Set();
  for (const table of repeatableTables) {
    for (const col of table.columns || []) {
      if (col.token) rowTokens.add(String(col.token).toLowerCase());
    }
  }
  const all = extractPlaceholdersFromText(plain);
  const placeholders = all.filter((p) => !rowTokens.has(String(p.token || '').toLowerCase()));
  return { plain, placeholders, repeatableTables };
}

/**
 * Find DOCX tables whose single sample body row is a cloneable line-item prototype.
 *
 * Skip fixed schedules that put placeholders on multiple different body rows
 * (e.g. compensation matrices). Only tables with exactly one placeholder body row
 * after the header are treated as repeatable (e.g. Asset Issued).
 */
export function detectRepeatableTables(xml = '') {
  const tables = [];
  const tblRe = /<w:tbl\b[\s\S]*?<\/w:tbl>/gi;
  let tblMatch;
  let tableIndex = -1;

  while ((tblMatch = tblRe.exec(String(xml))) !== null) {
    tableIndex += 1;
    const tblXml = tblMatch[0];
    const rows = [...tblXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/gi)].map((m) => m[0]);
    if (!rows.length) continue;

    let headerIdx = -1;
    if (/<w:tblHeader\b/i.test(rows[0])) {
      headerIdx = 0;
    } else {
      const firstCells = [];
      const tcRe = /<w:tc\b[\s\S]*?<\/w:tc>/gi;
      let tc;
      while ((tc = tcRe.exec(rows[0])) !== null) {
        firstCells.push(cellRich(tc[0]));
      }
      if (firstCells.some((c) => c.bold)) headerIdx = 0;
    }

    const bodyStart = headerIdx >= 0 ? headerIdx + 1 : 0;
    const placeholderBodyIndexes = [];
    for (let i = bodyStart; i < rows.length; i += 1) {
      const rowPlain = xmlFragmentToPlain(rows[i]);
      if (/\[[^\]]+\]/.test(rowPlain)) placeholderBodyIndexes.push(i);
    }

    // Fixed multi-row schedules keep placeholders as document-level fields.
    if (placeholderBodyIndexes.length !== 1) continue;

    const prototypeRowIndex = placeholderBodyIndexes[0];
    const protoPlain = xmlFragmentToPlain(rows[prototypeRowIndex]);
    const columns = normalizeDetectedLineColumns(extractPlaceholdersFromText(protoPlain));
    if (!columns.length) continue;

    // Prefer rows that are mostly merge fields (not prose with one embedded token).
    const cellTexts = [];
    const tcRe2 = /<w:tc\b[\s\S]*?<\/w:tc>/gi;
    let tc2;
    while ((tc2 = tcRe2.exec(rows[prototypeRowIndex])) !== null) {
      const text = cellPlain(tc2[0]);
      if (text) cellTexts.push(text);
    }
    const placeholderDominant = cellTexts.filter((text) => {
      const stripped = String(text)
        .replace(/\[[^\]]+\]/g, '')
        .replace(/[₹$€£\s.,_\-–—:/\\()]/g, '');
      return stripped.length === 0 && /\[[^\]]+\]/.test(text);
    }).length;
    if (cellTexts.length >= 2 && placeholderDominant < Math.ceil(cellTexts.length * 0.6)) {
      continue;
    }

    tables.push({
      id: `table_${tableIndex + 1}`,
      tableIndex,
      prototypeRowIndex,
      columns,
      minRows: 1,
      maxRows: 20,
    });
  }

  return tables;
}

function fillTokensInXmlFragment(fragmentXml, columns = [], rowValues = {}) {
  let next = fragmentXml;
  for (const col of columns) {
    const value =
      rowValues[col.key] ??
      rowValues[col.token] ??
      rowValues[col.inner] ??
      rowValues[col.label] ??
      '';
    if (value === '' || value == null) continue;
    const pattern = new RegExp(xmlSoftPattern(col.token));
    next = next.replace(pattern, escapeXml(String(value)));
  }
  return next;
}

/**
 * Clone each prototype body row N times and fill per-row values inside each clone.
 */
export function expandRepeatableTables(xml = '', repeatableTables = [], lineRows = {}) {
  if (!Array.isArray(repeatableTables) || !repeatableTables.length) return String(xml);

  let tableIndex = -1;
  return String(xml).replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/gi, (tblXml) => {
    tableIndex += 1;
    const meta = repeatableTables.find((t) => Number(t.tableIndex) === tableIndex);
    if (!meta) return tblXml;

    const dataRows = Array.isArray(lineRows?.[meta.id]) ? lineRows[meta.id] : [];
    if (!dataRows.length) return tblXml;

    let trIndex = -1;
    let expanded = false;
    return tblXml.replace(/<w:tr\b[\s\S]*?<\/w:tr>/gi, (trXml) => {
      trIndex += 1;
      if (trIndex !== Number(meta.prototypeRowIndex)) return trXml;
      if (expanded) return '';
      expanded = true;
      return dataRows
        .map((rowVals) => fillTokensInXmlFragment(trXml, meta.columns || [], rowVals || {}))
        .join('');
    });
  });
}

export async function fillDocxBuffer(buffer, values = {}, options = {}) {
  const storedTables = Array.isArray(options.repeatableTables) ? options.repeatableTables : [];
  const incomingRows = options.lineRows && typeof options.lineRows === 'object' ? options.lineRows : {};
  const { zip, xml: rawXml, plain: rawPlain } = await readDocxBuffer(buffer);
  const xml = rewriteServiceAgreementLineTableXml(rawXml);
  const plain = xml === rawXml ? rawPlain : xmlFragmentToPlain(xml);
  const detected = detectRepeatableTables(xml);
  const repeatableTables = (detected.length ? detected : storedTables).map((table) => {
    const stored = storedTables.find(
      (s) => s.id === table.id || Number(s.tableIndex) === Number(table.tableIndex)
    );
    return {
      ...table,
      id: stored?.id || table.id,
      minRows: stored?.minRows ?? table.minRows,
      maxRows: stored?.maxRows ?? table.maxRows,
    };
  });
  const lineRows = remapLineRowsToLiveTables(incomingRows, storedTables, repeatableTables);

  let nextXml = expandRepeatableTables(xml, repeatableTables, lineRows);

  const documentPlaceholders =
    Array.isArray(options.documentPlaceholders) && options.documentPlaceholders.length
      ? options.documentPlaceholders
      : (() => {
          const rowTokens = new Set();
          for (const table of repeatableTables) {
            for (const col of table.columns || []) {
              if (col.token) rowTokens.add(String(col.token).toLowerCase());
            }
          }
          return extractPlaceholdersFromText(plain).filter(
            (p) => !rowTokens.has(String(p.token || '').toLowerCase())
          );
        })();

  for (const ph of documentPlaceholders) {
    const value =
      values[ph.key] ??
      values[ph.token] ??
      values[ph.inner] ??
      values[ph.label] ??
      '';
    if (value === '' || value == null) continue;
    const display = formatMergeValue(ph, value);
    const pattern = new RegExp(xmlSoftPattern(ph.token));
    nextXml = nextXml.replace(pattern, escapeXml(display));
  }

  const filledBuffer = await repackDocxDocumentXml(buffer, nextXml);
  const filledText = fillTextPlaceholders(
    xmlFragmentToPlain(nextXml),
    values,
    documentPlaceholders
  );
  const images = await loadDocxImageMap(zip);
  const blocks = parseDocxBlocks(nextXml, images);
  return {
    filledBuffer,
    filledText,
    placeholders: documentPlaceholders,
    repeatableTables,
    blocks: blocks.length ? blocks : [{ type: 'p', text: filledText }],
  };
}

function dataUrlToBuffer(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  try {
    return Buffer.from(dataUrl.slice(comma + 1), 'base64');
  } catch {
    return null;
  }
}

function isSignerDone(signer) {
  return (
    signer &&
    (signer.status === 'SIGNED' || signer.status === 'ACKNOWLEDGED') &&
    Boolean(signer.signatureData || signer.name)
  );
}

/** Draw one party column inside the footer. */
function drawPartyColumn(doc, { x, y, width, label, signer, placeholder, showDate }) {
  const textOpts = { width, lineBreak: false };
  doc.fillColor('#5a6d79').fontSize(6.5).font('Helvetica-Bold');
  doc.text(label, x, y, textOpts);

  const done = isSignerDone(signer);
  const data = signer?.signatureData || '';
  const isImage =
    done &&
    (signer.signatureType === 'DRAWN' ||
      signer.signatureType === 'UPLOADED' ||
      (typeof data === 'string' && data.startsWith('data:image')));

  if (done && isImage) {
    const img = dataUrlToBuffer(data);
    if (img) {
      try {
        doc.image(img, x, y + 12, { height: 22, fit: [Math.min(width - 8, 140), 22] });
      } catch {
        doc
          .font('Helvetica-Oblique')
          .fontSize(9)
          .fillColor('#0e1a22')
          .text(signer.name || '', x, y + 16, textOpts);
      }
    }
  } else if (done) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(11)
      .fillColor('#0e1a22')
      .text(String(data || signer.name).slice(0, 36), x, y + 14, textOpts);
  } else {
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor('#9aa8b2')
      .text(String(placeholder || 'Awaiting').slice(0, 28), x, y + 16, textOpts);
  }

  doc
    .strokeColor('#c5d0d8')
    .lineWidth(0.6)
    .moveTo(x, y + 38)
    .lineTo(x + Math.min(width - 8, 120), y + 38)
    .stroke();

  if (done && signer.name) {
    doc.font('Helvetica').fontSize(6.5).fillColor('#5a6d79').text(signer.name, x, y + 40, textOpts);
  }

  if (showDate) {
    const when = signer?.acknowledgedAt || signer?.signedAt;
    const dateStr = done && when ? formatDate(when) : '-';
    doc
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor('#5a6d79')
      .text(`Date: ${dateStr}`, x, y + 50, textOpts);
  }
}

/**
 * Draw dual signature slots at the bottom of the current page (compact).
 * Left = Sender · Right = Receiver + date line.
 * Must not trigger PDFKit page breaks (footer sits inside the bottom margin).
 */
export function drawSignatureFooter(
  doc,
  {
    signingType = 'SIGNING',
    senderSample = 'Sender',
    senderSignature = null,
    receiverSignature = null,
  } = {}
) {
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const left = doc.page.margins.left;
  const right = pageW - doc.page.margins.right;
  const mid = (left + right) / 2;
  const footerTop = pageH - 88;

  const prevX = doc.x;
  const prevY = doc.y;
  const prevBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  doc.save();
  try {
    doc
      .strokeColor('#0e1a22')
      .lineWidth(0.9)
      .moveTo(left, footerTop)
      .lineTo(right, footerTop)
      .stroke();

    const colGap = 20;
    const colW = (right - left - colGap) / 2;

    drawPartyColumn(doc, {
      x: left,
      y: footerTop + 6,
      width: colW,
      label: 'SENDER / OWNER',
      signer: senderSignature,
      placeholder: senderSample || 'Sender',
      showDate: false,
    });

    drawPartyColumn(doc, {
      x: mid + colGap / 2,
      y: footerTop + 6,
      width: colW,
      label: signingType === 'NON_SIGNING' ? 'RECEIVER / ACKNOWLEDGE' : 'RECEIVER',
      signer: receiverSignature,
      placeholder: signingType === 'NON_SIGNING' ? 'Acknowledge' : 'Receiver',
      showDate: true,
    });
  } finally {
    doc.restore();
    doc.page.margins.bottom = prevBottom;
    doc.x = prevX;
    doc.y = prevY;
  }
}

function resolveFontPair() {
  const pairs = [
    { regular: 'C:/Windows/Fonts/arial.ttf', bold: 'C:/Windows/Fonts/arialbd.ttf' },
    { regular: 'C:/Windows/Fonts/calibri.ttf', bold: 'C:/Windows/Fonts/calibrib.ttf' },
    {
      regular: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    },
    {
      regular: '/System/Library/Fonts/Supplemental/Arial.ttf',
      bold: '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    },
  ];
  for (const p of pairs) {
    if (fs.existsSync(p.regular)) {
      return {
        regular: p.regular,
        bold: fs.existsSync(p.bold) ? p.bold : p.regular,
      };
    }
  }
  return null;
}

function normalizePdfText(s = '') {
  return String(s)
    .replace(/\u20B9/g, 'Rs ')
    .replace(/\u00A0/g, ' ')
    .replace(/\r/g, '');
}

function runIsBold(runXml = '') {
  // <w:b/> or <w:b w:val="true|1"/>. not bold when val="0" or "false"
  if (/<w:b\b[^>]*w:val\s*=\s*"(?:0|false)"/i.test(runXml)) return false;
  if (/<w:b\b/i.test(runXml)) return true;
  if (/<w:bCs\b[^>]*w:val\s*=\s*"(?:0|false)"/i.test(runXml)) return false;
  if (/<w:bCs\b/i.test(runXml)) return true;
  return false;
}

function paragraphIsHeading(pXml = '') {
  const style = pXml.match(/<w:pStyle[^>]*w:val="([^"]+)"/i);
  if (style && /heading|title|subtitle/i.test(style[1])) return true;
  return false;
}

/**
 * Extract text runs with bold flags from a paragraph/cell XML fragment.
 * Returns { text, bold, heading, runs }
 */
export function extractRichText(xml = '') {
  const heading = paragraphIsHeading(xml);
  const runs = [];
  const runRe = /<w:r\b[\s\S]*?<\/w:r>/gi;
  let m;
  while ((m = runRe.exec(xml)) !== null) {
    const runXml = m[0];
    const textParts = [];
    const tRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>/gi;
    let tm;
    while ((tm = tRe.exec(runXml)) !== null) {
      textParts.push(decodeXmlEntities(tm[1]));
    }
    // tabs / breaks inside run
    if (/<w:tab\/>/i.test(runXml)) textParts.push('\t');
    if (/<w:br\b/i.test(runXml)) textParts.push('\n');
    const text = textParts.join('');
    if (!text) continue;
    runs.push({ text, bold: runIsBold(runXml) || heading });
  }

  if (!runs.length) {
    const plain = xmlFragmentToPlain(xml);
    return {
      text: plain,
      bold: heading,
      heading,
      runs: plain ? [{ text: plain, bold: heading }] : [],
    };
  }

  const text = runs.map((r) => r.text).join('');
  const boldChars = runs.reduce((n, r) => n + (r.bold ? r.text.replace(/\s/g, '').length : 0), 0);
  const totalChars = text.replace(/\s/g, '').length || 1;
  const mostlyBold = boldChars / totalChars >= 0.6;
  return {
    text: text.replace(/\n+/g, ' ').trim() || text.trim(),
    bold: heading || mostlyBold,
    heading,
    runs,
  };
}

function cellRich(tcXml = '') {
  const rich = extractRichText(tcXml);
  return {
    text: rich.text.replace(/\n+/g, ' ').trim(),
    bold: rich.bold || rich.heading,
    image: null,
  };
}

export async function loadDocxImageMap(zip) {
  const images = {};
  if (!zip?.file) return images;
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (!relsFile) return images;
  const relsXml = await relsFile.async('string');
  const tagRe = /<Relationship\b[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(relsXml)) !== null) {
    const tag = m[0];
    if (!/\/image"/i.test(tag) && !/relationships\/image/i.test(tag)) continue;
    const id = (tag.match(/\bId="([^"]+)"/i) || [])[1];
    const target = (tag.match(/\bTarget="([^"]+)"/i) || [])[1];
    if (!id || !target) continue;
    const cleaned = String(target).replace(/^\.\//, '').replace(/^\//, '');
    const pathInZip = cleaned.startsWith('word/') ? cleaned : `word/${cleaned}`;
    const file = zip.file(pathInZip);
    if (!file) continue;
    try {
      images[id] = await file.async('nodebuffer');
    } catch {
      /* skip unreadable media */
    }
  }
  return images;
}

function firstEmbeddedImage(xml = '', images = {}) {
  const id = (String(xml).match(/a:blip[^>]*r:embed="([^"]+)"/i) || [])[1];
  if (!id) return null;
  return images[id] || null;
}

export function paragraphAlign(pXml = '') {
  const raw = (String(pXml).match(/<w:jc\b[^>]*w:val="([^"]+)"/i) || [])[1];
  const v = String(raw || '').toLowerCase();
  if (v === 'center') return 'center';
  if (v === 'right' || v === 'end') return 'right';
  return 'left';
}

export function paragraphIsUnderlined(pXml = '') {
  return /<w:u\b(?![^>]*w:val="(?:none|0)")/i.test(String(pXml));
}

export function isLetterheadTable(rows = []) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 3) return false;
  if ((rows[0] || []).length !== 2) return false;
  const left = rows[0][0] || {};
  const right = rows[0][1] || {};
  if (left.image || right.image) return true;
  const lt = cellText(left);
  const rt = cellText(right);
  if (/tylo|logo/i.test(lt) && rt.length > 12) return true;
  return lt.length < 48 && /limited|mumbai|address|tower/i.test(rt);
}

export function isDocumentTitleText(text = '') {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 48) return false;
  const upper = t.toUpperCase();
  return upper === t && /AGREEMENT|LETTER|NDA|ANNEXURE/.test(upper);
}

/**
 * Parse DOCX body into blocks so tables survive into PDF.
 * Paragraphs: { type:'p', text, bold, heading, align, underline, image }
 * Tables: { type:'table', rows, letterhead }
 */
export function parseDocxBlocks(xml = '', images = {}) {
  const bodyMatch = String(xml).match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/i);
  let body = bodyMatch ? bodyMatch[1] : String(xml);
  body = body.replace(/<w:sectPr[\s\S]*$/i, '');

  const blocks = [];
  const tokenRe = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/gi;
  let m;
  while ((m = tokenRe.exec(body)) !== null) {
    const chunk = m[0];
    if (/^<w:tbl\b/i.test(chunk)) {
      const rows = [];
      const trRe = /<w:tr\b[\s\S]*?<\/w:tr>/gi;
      let tr;
      while ((tr = trRe.exec(chunk)) !== null) {
        const cells = [];
        const tcRe = /<w:tc\b[\s\S]*?<\/w:tc>/gi;
        let tc;
        while ((tc = tcRe.exec(tr[0])) !== null) {
          const cell = cellRich(tc[0]);
          cell.image = firstEmbeddedImage(tc[0], images);
          cells.push(cell);
        }
        if (cells.length) {
          const isTblHeader = /<w:tblHeader\b/i.test(tr[0]);
          rows.push(isTblHeader ? cells.map((c) => ({ ...c, bold: true })) : cells);
        }
      }
      if (rows.length) {
        const first = rows[0];
        const firstHasBold = first.some((c) => c.bold);
        if (firstHasBold) {
          rows[0] = first.map((c) => ({ ...c, bold: true }));
        }
        blocks.push({ type: 'table', rows, letterhead: isLetterheadTable(rows) });
      }
    } else {
      const rich = extractRichText(chunk);
      if (rich.text || firstEmbeddedImage(chunk, images)) {
        blocks.push({
          type: 'p',
          text: rich.text,
          bold: rich.bold,
          heading: rich.heading,
          align: paragraphAlign(chunk),
          underline: paragraphIsUnderlined(chunk),
          image: firstEmbeddedImage(chunk, images),
          runs: rich.runs,
        });
      }
    }
  }
  return blocks;
}

function cellText(cell) {
  if (cell == null) return '';
  if (typeof cell === 'string') return cell;
  return cell.text || '';
}

function cellIsBold(cell, forceHeader = false) {
  if (forceHeader) return true;
  if (cell == null) return false;
  if (typeof cell === 'string') return false;
  return Boolean(cell.bold);
}

function measureWrappedHeight(doc, text, width, fontSize) {
  doc.fontSize(fontSize);
  const h = doc.heightOfString(normalizePdfText(text || ' '), {
    width: Math.max(20, width - 10),
    lineGap: 2,
  });
  return Math.max(22, h + 12);
}

function drawHairline(doc) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  doc
    .strokeColor('#111111')
    .lineWidth(0.8)
    .moveTo(left, doc.y)
    .lineTo(right, doc.y)
    .stroke();
  doc.moveDown(0.55);
}

function drawLetterheadBand(doc, { image, text, extra, regularFont, boldFont }) {
  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startY = doc.y;
  let logoW = 0;
  let logoH = 0;
  if (image) {
    try {
      logoH = 38;
      doc.image(image, left, startY, { height: logoH, fit: [96, 42] });
      logoW = 102;
    } catch {
      logoW = 0;
      logoH = 0;
    }
  }
  const textX = left + logoW;
  const textW = Math.max(120, usable - logoW);
  const lines = [text, extra].map((t) => normalizePdfText(t || '').trim()).filter(Boolean);
  doc.fillColor('#0e1a22').font(boldFont).fontSize(11);
  let y = startY;
  lines.forEach((line, idx) => {
    const useBold = idx === 0;
    doc.font(useBold ? boldFont : regularFont).fontSize(idx === 0 ? 11 : 8.5);
    const h = doc.heightOfString(line, { width: textW, lineGap: 1.5 });
    doc.text(line, textX, y, { width: textW, align: 'right', lineGap: 1.5 });
    y += h + 2;
  });
  doc.x = left;
  doc.y = Math.max(startY + logoH, y) + 8;
  drawHairline(doc);
}

function drawLetterheadTable(doc, rows, fonts) {
  const left = rows[0]?.[0] || {};
  const right = rows[0]?.[1] || {};
  drawLetterheadBand(doc, {
    image: left.image || right.image || null,
    text: cellText(right.image && !left.image ? left : right) || cellText(left),
    extra: rows[1] ? `${cellText(rows[1][0])} ${cellText(rows[1][1])}`.trim() : '',
    ...fonts,
  });
}

function drawPdfTable(doc, rows, { regularFont, boldFont } = {}) {
  if (!rows?.length) return;
  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colCount = Math.max(...rows.map((r) => r.length), 1);
  const colW = usable / colCount;
  const fontSize = 10;
  const bottomLimit = doc.page.height - doc.page.margins.bottom - 8;
  const headerRow = rows[0]?.some((c) => cellIsBold(c)) || false;

  for (let ri = 0; ri < rows.length; ri += 1) {
    const row = rows[ri];
    const forceHeader = headerRow && ri === 0;
    const heights = [];
    for (let ci = 0; ci < colCount; ci += 1) {
      const cell = normalizePdfText(cellText(row[ci]) || ' ');
      const useBold = cellIsBold(row[ci], forceHeader);
      doc.font(useBold ? boldFont : regularFont);
      heights.push(measureWrappedHeight(doc, cell, colW, fontSize));
    }
    const rowH = Math.max(...heights, 22);

    if (doc.y + rowH > bottomLimit) {
      doc.addPage();
    }

    const y0 = doc.y;

    for (let ci = 0; ci < colCount; ci += 1) {
      const x = left + ci * colW;
      const useBold = cellIsBold(row[ci], forceHeader);
      if (forceHeader) {
        doc.save();
        doc.rect(x, y0, colW, rowH).fill('#f1f5f9');
        doc.restore();
      }
      doc
        .strokeColor('#94a3b8')
        .lineWidth(0.7)
        .rect(x, y0, colW, rowH)
        .stroke();

      doc
        .fillColor('#0e1a22')
        .font(useBold ? boldFont : regularFont)
        .fontSize(fontSize)
        .text(normalizePdfText(cellText(row[ci]) || ''), x + 5, y0 + 6, {
          width: colW - 10,
          lineGap: 2,
        });
    }
    doc.x = left;
    doc.y = y0 + rowH;
  }
  doc.moveDown(0.6);
}

export function blocksToPdfBuffer(title, blocks = [], options = {}) {
  const signingType =
    options.signingType === 'NON_SIGNING' || options.signingType === 'non_signing'
      ? 'NON_SIGNING'
      : 'SIGNING';
  const showSignatures = options.showSignatures !== false;
  const hasLiveMarks = Boolean(options.senderSignature || options.receiverSignature);
  const fontPair = resolveFontPair();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margins: showSignatures
        ? { top: 50, bottom: 110, left: 50, right: 50 }
        : { top: 50, bottom: 50, left: 50, right: 50 },
      size: 'A4',
      bufferPages: true,
      info: {
        Title: title || 'Agreement',
        Author: 'TYLO One',
        Creator: 'TYLO One Document Master',
      },
      permissions: {
        printing: 'highResolution',
        modifying: false,
        copying: false,
        annotating: false,
        fillingForms: false,
        contentAccessibility: true,
        documentAssembly: false,
      },
      userPassword: undefined,
      ownerPassword: `tylo-one-lock-${Date.now()}`,
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let regularFont = 'Helvetica';
    let boldFont = 'Helvetica-Bold';
    if (fontPair) {
      try {
        doc.registerFont('Body', fontPair.regular);
        doc.registerFont('BodyBold', fontPair.bold);
        regularFont = 'Body';
        boldFont = 'BodyBold';
      } catch {
        regularFont = 'Helvetica';
        boldFont = 'Helvetica-Bold';
      }
    }

    const stampAllPages = () => {
      if (!showSignatures) return;
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        drawSignatureFooter(doc, {
          signingType,
          senderSample: options.senderSample || 'Sender',
          senderSignature: options.senderSignature || null,
          receiverSignature: options.receiverSignature || null,
        });
      }
    };

    const omitChrome = options.omitAppChrome === true;
    if (!omitChrome) {
      doc
        .fillColor('#0a5650')
        .font(boldFont)
        .fontSize(16)
        .text(title || 'Agreement', { align: 'left' });
      doc.moveDown(0.35);
      doc
        .fillColor('#5a6d79')
        .font(regularFont)
        .fontSize(9)
        .text(
          showSignatures
            ? hasLiveMarks
              ? 'Executed document · Signature footer on every page (Sender left · Receiver right)'
              : 'Non-editable PDF preview · Signature footer on every page (Sender left · Receiver right)'
            : 'Non-editable PDF preview · Generated by TYLO One',
          { align: 'left' }
        );
      doc.moveDown(0.7);
      doc
        .strokeColor('#d4dde4')
        .lineWidth(1)
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
      doc.moveDown(0.7);
    }

    const list = Array.isArray(blocks) && blocks.length ? blocks : [{ type: 'p', text: '(Empty document)' }];
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const fonts = { regularFont, boldFont };

    for (let i = 0; i < list.length; i += 1) {
      const block = list[i];
      if (block.type === 'table') {
        if (block.letterhead || isLetterheadTable(block.rows)) {
          drawLetterheadTable(doc, block.rows, fonts);
        } else {
          drawPdfTable(doc, block.rows, fonts);
        }
        continue;
      }
      const text = normalizePdfText(block.text || '').trim();
      const next = list[i + 1];
      const nextText = normalizePdfText(next?.text || '').trim();
      if (block.image || (i === 0 && /tylo care/i.test(text))) {
        const extra = /GSTIN|CIN:/i.test(nextText) ? nextText : '';
        if (extra) i += 1;
        drawLetterheadBand(doc, { image: block.image, text, extra, ...fonts });
        continue;
      }
      if (!text) continue;
      const titleLike = Boolean(block.heading) || isDocumentTitleText(text);
      const align = titleLike ? 'center' : block.align || 'left';
      const isHeading = Boolean(titleLike || block.bold);
      doc
        .fillColor('#0e1a22')
        .font(isHeading ? boldFont : regularFont)
        .fontSize(titleLike ? 13 : isHeading ? 11 : 11)
        .text(text, {
          align,
          underline: Boolean(block.underline || titleLike),
          lineGap: 4,
          width: contentWidth,
        });
      doc.moveDown(titleLike ? 0.55 : isHeading ? 0.45 : 0.35);
    }

    stampAllPages();
    doc.end();
  });
}

export function textToPdfBuffer(title, text, options = {}) {
  if (options.blocks?.length) {
    return blocksToPdfBuffer(title, options.blocks, options);
  }
  const paragraphs = String(text || '')
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ type: 'p', text: t }));
  return blocksToPdfBuffer(title, paragraphs.length ? paragraphs : [{ type: 'p', text: '(Empty document)' }], options);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeBuffer(filePath, buffer) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buffer);
  return filePath;
}
