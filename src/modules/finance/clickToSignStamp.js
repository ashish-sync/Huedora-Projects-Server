/**
 * Finance Click-to-Sign stamp for PDFKit commercial documents.
 * Matches UI: UPPERCASE NAME + "Digitally signed on DD-MM-YYYY HH:MM:SS"
 */

import { formatDate } from '../../utils/dateFormat.js';

export const CLICK_TO_SIGN_MODE = 'click_to_sign';

function parseToDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatTimeWithSeconds(value) {
  const date = parseToDate(value);
  if (!date) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function formatDigitallySignedOn(signedAt) {
  const date = parseToDate(signedAt);
  if (!date) return '';
  return `Digitally signed on ${formatDate(date)} ${formatTimeWithSeconds(date)}`;
}

export function normalizeSignatoryDisplayName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function isClickToSignSignature(signature) {
  if (!signature || typeof signature !== 'object') return false;
  return (
    signature.mode === CLICK_TO_SIGN_MODE
    && Boolean(String(signature.signedAt || '').trim())
    && Boolean(normalizeSignatoryDisplayName(signature.signatoryName))
  );
}

/** Resolve signature object from commercial doc row / builderForm. */
export function resolveDocumentSignature(docRow = {}) {
  const fromForm = docRow.builderForm?.signature;
  if (fromForm && typeof fromForm === 'object') return fromForm;
  if (docRow.signature && typeof docRow.signature === 'object') return docRow.signature;
  return null;
}

/**
 * Draw click-to-sign block scaled to fit `w` (never overflows the signature box).
 * Layout: NAME → Digitally signed on… → AUTHORISED SIGNATORY (brand blue).
 * @returns {number} y after drawing
 */
export function drawClickToSignBlock(pdf, signature, x, y, w, {
  align = 'center',
  ink = '#111111',
  labelInk = '#1e3a5f',
  showAuthorisedLabel = true,
} = {}) {
  if (!isClickToSignSignature(signature)) return y;
  const name = normalizeSignatoryDisplayName(signature.signatoryName);
  const meta = formatDigitallySignedOn(signature.signedAt);
  const boxW = Math.max(20, Number(w) || 120);

  function fitFontSize(text, fontName, minSize = 6, maxSize = 14, spacingFactor = 0.05) {
    let size = maxSize;
    pdf.font(fontName);
    const target = boxW * 0.94;
    while (size > minSize) {
      pdf.fontSize(size);
      const spacing = Math.max(0.2, size * spacingFactor);
      const gaps = Math.max(0, text.length - 1);
      const width = pdf.widthOfString(text) + gaps * spacing;
      if (width <= target) break;
      size -= 0.5;
    }
    return size;
  }

  const nameSize = fitFontSize(name, 'Helvetica', 7, 12, 0.04);
  const nameSpacing = Math.max(0.25, nameSize * 0.04);
  pdf.font('Helvetica').fontSize(nameSize).fillColor(ink).text(name, x, y, {
    width: boxW,
    align,
    lineBreak: false,
    characterSpacing: nameSpacing,
  });
  let nextY = y + nameSize + 4;
  const metaSize = fitFontSize(meta, 'Helvetica-Bold', 6, Math.max(7.5, nameSize * 0.75), 0.02);
  const metaSpacing = Math.max(0.15, metaSize * 0.02);
  pdf.font('Helvetica-Bold').fontSize(metaSize).fillColor(ink).text(meta, x, nextY, {
    width: boxW,
    align,
    lineBreak: false,
    characterSpacing: metaSpacing,
  });
  nextY += metaSize + 2;

  if (showAuthorisedLabel) {
    nextY += 10;
    pdf.font('Helvetica-Bold').fontSize(8).fillColor(labelInk).text('AUTHORISED SIGNATORY', x, nextY, {
      width: boxW,
      align,
      lineBreak: false,
      characterSpacing: 0.45,
    });
    nextY += 10;
  }

  return nextY;
}
