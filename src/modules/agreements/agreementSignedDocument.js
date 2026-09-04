import { v4 as uuid } from 'uuid';
import { AgreementDocument } from './agreement.model.js';
import { buildAgreementPdfBuffer, pdfOptionsFromAgreement } from './agreementPdf.js';
import { writeUploadBuffer } from '../../storage/persistUpload.js';

/**
 * Persist the fully signed agreement PDF as the primary contract document.
 * Prior primary files are kept as non-primary attachments.
 */
export async function persistSignedAgreementPdf(agreement, uploadedBy = null) {
  if (!agreement) return null;
  if (!['COMPLETED', 'ACTIVE'].includes(agreement.status)) return null;

  const pdfBuffer = await buildAgreementPdfBuffer(agreement, pdfOptionsFromAgreement(agreement));
  if (!pdfBuffer?.length) return null;

  const existing = await AgreementDocument.find({
    agreementId: agreement._id,
    isDeleted: false,
  });
  const maxVersion = existing.reduce((m, d) => Math.max(m, Number(d.version) || 1), 0);

  for (const doc of existing) {
    if (doc.isPrimary) {
      doc.isPrimary = false;
      doc.docKind = doc.docKind === 'CONTRACT' ? 'ATTACHMENT' : doc.docKind;
      await doc.save();
    }
  }

  const safeTitle = String(agreement.title || agreement.agreementNumber || 'agreement')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80);
  const pdfKey = `${uuid()}-${safeTitle}-signed.pdf`;
  await writeUploadBuffer(`agreements/${pdfKey}`, pdfBuffer, {
    contentType: 'application/pdf',
  });

  const record = await AgreementDocument.create({
    agreementId: agreement._id,
    name: `${safeTitle}-signed.pdf`,
    docKind: 'CONTRACT',
    contentType: 'application/pdf',
    sizeBytes: pdfBuffer.length,
    storageKey: pdfKey,
    version: maxVersion + 1,
    isPrimary: true,
    uploadedBy: uploadedBy || null,
    replacedPrevious: maxVersion > 0,
  });

  return record;
}
