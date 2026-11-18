/**
 * Stamp TYLO dual signature footer onto an existing PDF (LibreOffice output).
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { formatDate } from '../../utils/dateFormat.js';

function dataUrlToUint8(dataUrl) {
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

function isImageSignaturePayload(signer) {
  const data = signer?.signatureData || '';
  return (
    signer?.signatureType === 'DRAWN' ||
    signer?.signatureType === 'UPLOADED' ||
    (typeof data === 'string' && data.startsWith('data:image'))
  );
}

/** pdf-lib only embeds PNG/JPEG — convert WebP (and other formats) to PNG first. */
async function signatureBytesForPdf(dataUrl) {
  const bytes = dataUrlToUint8(dataUrl);
  if (!bytes?.length) return null;

  const asPng = async (input) => {
    const png = await sharp(input, { failOn: 'none' }).png().toBuffer();
    return { kind: 'png', bytes: png };
  };

  if (/image\/png/i.test(String(dataUrl))) {
    return { kind: 'png', bytes };
  }
  if (/image\/jpe?g/i.test(String(dataUrl))) {
    return { kind: 'jpg', bytes };
  }

  // WebP and anything else pdf-lib cannot embed directly
  try {
    return await asPng(bytes);
  } catch {
    return null;
  }
}

async function embedSignerImage(pdfDoc, signer) {
  if (!isSignerDone(signer)) return null;
  const data = signer.signatureData || '';
  if (!isImageSignaturePayload(signer)) return null;

  const prepared = await signatureBytesForPdf(data);
  if (!prepared?.bytes?.length) return null;

  try {
    if (prepared.kind === 'jpg') return await pdfDoc.embedJpg(prepared.bytes);
    return await pdfDoc.embedPng(prepared.bytes);
  } catch {
    try {
      const png = await sharp(prepared.bytes, { failOn: 'none' }).png().toBuffer();
      return await pdfDoc.embedPng(png);
    } catch {
      return null;
    }
  }
}

function drawParty(page, fonts, { x, y, width, label, signer, placeholder, showDate, image }) {
  const { helvetica, helveticaBold, helveticaOblique } = fonts;
  page.drawText(label, {
    x,
    y: y + 62,
    size: 6.5,
    font: helveticaBold,
    color: rgb(0.35, 0.43, 0.47),
    maxWidth: width,
  });

  const done = isSignerDone(signer);
  if (done && image) {
    const maxW = Math.min(width - 8, 140);
    const scale = Math.min(maxW / image.width, 22 / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    page.drawImage(image, { x, y: y + 32, width: w, height: h });
  } else if (done) {
    // Never print raw data URLs when image embed fails — fall back to the name.
    const raw = String(signer.signatureData || '');
    const text = (
      raw.startsWith('data:image')
        ? String(signer.name || 'Signed')
        : raw || String(signer.name || 'Signed')
    ).slice(0, 36);
    page.drawText(text, {
      x,
      y: y + 40,
      size: 11,
      font: helveticaOblique,
      color: rgb(0.05, 0.1, 0.13),
      maxWidth: width,
    });
  } else {
    page.drawText(String(placeholder || 'Awaiting').slice(0, 28), {
      x,
      y: y + 40,
      size: 9,
      font: helveticaOblique,
      color: rgb(0.6, 0.66, 0.7),
      maxWidth: width,
    });
  }

  page.drawLine({
    start: { x, y: y + 28 },
    end: { x: x + Math.min(width - 8, 120), y: y + 28 },
    thickness: 0.6,
    color: rgb(0.77, 0.82, 0.85),
  });

  if (done && signer.name) {
    page.drawText(String(signer.name).slice(0, 40), {
      x,
      y: y + 16,
      size: 6.5,
      font: helvetica,
      color: rgb(0.35, 0.43, 0.47),
      maxWidth: width,
    });
  }

  if (showDate) {
    const when = signer?.acknowledgedAt || signer?.signedAt;
    const dateStr = done && when ? formatDate(when) : '-';
    page.drawText(`Date: ${dateStr}`, {
      x,
      y: y + 6,
      size: 6.5,
      font: helvetica,
      color: rgb(0.35, 0.43, 0.47),
      maxWidth: width,
    });
  }
}

/**
 * @param {Buffer} pdfBuffer
 * @param {object} options
 * @returns {Promise<Buffer>}
 */
export async function stampSignatureFooterOnPdf(pdfBuffer, options = {}) {
  const signingType =
    options.signingType === 'NON_SIGNING' || options.signingType === 'non_signing'
      ? 'NON_SIGNING'
      : 'SIGNING';
  if (options.showSignatures === false) return pdfBuffer;

  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fonts = { helvetica, helveticaBold, helveticaOblique };

  const senderImg = await embedSignerImage(pdfDoc, options.senderSignature);
  const receiverImg = await embedSignerImage(pdfDoc, options.receiverSignature);

  const pages = pdfDoc.getPages();
  for (const page of pages) {
    const { width, height } = page.getSize();
    const left = 50;
    const right = width - 50;
    const footerH = 88;
    const footerTop = footerH;

    page.drawRectangle({
      x: 0,
      y: 0,
      width,
      height: footerH,
      color: rgb(1, 1, 1),
    });

    page.drawLine({
      start: { x: left, y: footerTop },
      end: { x: right, y: footerTop },
      thickness: 0.9,
      color: rgb(0.05, 0.1, 0.13),
    });

    const colGap = 20;
    const colW = (right - left - colGap) / 2;
    const mid = (left + right) / 2;

    drawParty(page, fonts, {
      x: left,
      y: 0,
      width: colW,
      label: 'SENDER / OWNER',
      signer: options.senderSignature || null,
      placeholder: options.senderSample || 'Sender',
      showDate: false,
      image: senderImg,
    });

    drawParty(page, fonts, {
      x: mid + colGap / 2,
      y: 0,
      width: colW,
      label: signingType === 'NON_SIGNING' ? 'RECEIVER / ACKNOWLEDGE' : 'RECEIVER',
      signer: options.receiverSignature || null,
      placeholder: signingType === 'NON_SIGNING' ? 'Acknowledge' : 'Receiver',
      showDate: true,
      image: receiverImg,
    });
  }

  const out = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(out);
}
