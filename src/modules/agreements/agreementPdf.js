import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { AgreementDocument } from './agreement.model.js';
import { parseDocxBufferBlocks, textToPdfBuffer } from '../templates/docxPlaceholders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const agreementUploadRoot = path.resolve(__dirname, '../../../uploads/agreements');

function isPdfDocument(doc) {
  const ct = String(doc?.contentType || '').toLowerCase();
  const name = String(doc?.name || doc?.storageKey || '').toLowerCase();
  return ct.includes('pdf') || name.endsWith('.pdf');
}

function isWordDocument(doc) {
  const ct = String(doc?.contentType || '').toLowerCase();
  const name = String(doc?.name || doc?.storageKey || '').toLowerCase();
  return (
    ct.includes('word') ||
    ct.includes('docx') ||
    ct.includes('msword') ||
    name.endsWith('.docx') ||
    name.endsWith('.doc')
  );
}

function partySigner(signers = [], side) {
  return (
    signers.find((s) => s.partySide === side) ||
    signers.find((s) => s.role === side) ||
    null
  );
}

function isDone(s) {
  return s?.status === 'SIGNED' || s?.status === 'ACKNOWLEDGED';
}

/**
 * Build the same PDF buffer staff and recipients see in document preview.
 */
export async function buildAgreementPdfBuffer(agreement, pdfOptions = {}) {
  const documents = await AgreementDocument.find({
    agreementId: agreement._id,
    isDeleted: false,
  });

  const bodyText =
    String(agreement.bodyHtml || '').trim() ||
    String(
      documents.find((d) => d.isPrimary && d.textContent)?.textContent ||
        documents.find((d) => d.textContent)?.textContent ||
        ''
    ).trim();

  const options = {
    signingType: agreement.signingType === 'NON_SIGNING' ? 'NON_SIGNING' : 'SIGNING',
    showSignatures: true,
    senderSample: 'Sender',
    ...pdfOptions,
  };

  // Prefer filled Word (keeps tables + bold) when regenerating with signature footer.
  const filledDocx =
    documents.find((d) => isWordDocument(d) && /filled/i.test(String(d.name || d.storageKey || ''))) ||
    documents.find((d) => isWordDocument(d) && d.isPrimary) ||
    documents.find((d) => isWordDocument(d));

  if (filledDocx?.storageKey) {
    const full = path.join(agreementUploadRoot, filledDocx.storageKey);
    if (fs.existsSync(full)) {
      const { plain, blocks } = await parseDocxBufferBlocks(fs.readFileSync(full));
      return textToPdfBuffer(agreement.title, plain || bodyText, { ...options, blocks });
    }
  }

  const hasLiveSignatures = Boolean(options.senderSignature || options.receiverSignature);

  if (bodyText && (hasLiveSignatures || agreement.documentSource !== 'UPLOAD')) {
    return textToPdfBuffer(agreement.title, bodyText, options);
  }

  const fileDoc =
    documents.find((d) => d.storageKey && d.isPrimary) ||
    documents.find((d) => d.storageKey && isPdfDocument(d)) ||
    documents.find((d) => d.storageKey);

  if (fileDoc?.storageKey) {
    const full = path.join(agreementUploadRoot, fileDoc.storageKey);
    if (fs.existsSync(full)) {
      if (isPdfDocument(fileDoc)) {
        return fs.readFileSync(full);
      }
      if (isWordDocument(fileDoc)) {
        const { plain, blocks } = await parseDocxBufferBlocks(fs.readFileSync(full));
        return textToPdfBuffer(agreement.title, plain, { ...options, blocks });
      }
    }
  }

  return textToPdfBuffer(agreement.title, bodyText, options);
}

export function pdfOptionsFromAgreement(agreement) {
  const sender = partySigner(agreement.signers, 'SENDER');
  const receiver =
    partySigner(agreement.signers, 'RECEIVER') ||
    (agreement.signers || []).find((s) => s.role === 'SIGNER' || s.role === 'RECIPIENT');
  return {
    signingType: agreement.signingType === 'NON_SIGNING' ? 'NON_SIGNING' : 'SIGNING',
    showSignatures: true,
    senderSample: sender?.name || 'Sender',
    senderSignature: isDone(sender) ? sender : null,
    receiverSignature: isDone(receiver) ? receiver : null,
  };
}
