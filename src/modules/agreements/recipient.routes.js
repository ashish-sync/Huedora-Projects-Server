import { Router } from 'express';
import { asyncHandler, AppError } from '../../utils/helpers.js';
import { formatDateTime } from '../../utils/dateFormat.js';
import { Agreement, AgreementActivity } from './agreement.model.js';
import { writeAudit } from '../../utils/audit.js';
import { findAgreementByAccessKey } from './recipientAccess.js';
import { syncLinkedAssetsFromAgreement } from '../assets/assetContactSync.js';
import { buildAgreementPdfBuffer, pdfOptionsFromAgreement } from './agreementPdf.js';

const router = Router();

function party(signers, side) {
  return (signers || []).find((s) => s.partySide === side || s.role === side) || null;
}

function computeStatus(agreement) {
  const signers = agreement.signers || [];
  if (agreement.status === 'ACTIVE' || agreement.status === 'TERMINATED') return agreement.status;
  const declined = signers.some((s) => s.status === 'DECLINED');
  if (declined) return 'DECLINED';
  const sender = party(signers, 'SENDER');
  const receiver =
    party(signers, 'RECEIVER') ||
    signers.find((s) => s.role === 'SIGNER' || s.role === 'RECIPIENT');
  const done = (s) => s?.status === 'SIGNED' || s?.status === 'ACKNOWLEDGED';

  if (agreement.signingType === 'NON_SIGNING') {
    if (receiver && done(receiver)) return 'COMPLETED';
    if (agreement.sentAt) return 'SENT';
    return agreement.status || 'DRAFT';
  }

  const relevant = [sender, receiver].filter(Boolean);
  if (!relevant.length) return agreement.status || 'DRAFT';
  if (relevant.every(done)) return 'COMPLETED';
  if (relevant.some(done)) return 'PARTIALLY_SIGNED';
  if (agreement.sentAt) return 'SENT';
  return agreement.status || 'DRAFT';
}

function publicAgreement(doc) {
  const sender = party(doc.signers, 'SENDER');
  const receiver =
    party(doc.signers, 'RECEIVER') ||
    (doc.signers || []).find((s) => s.role === 'SIGNER' || s.role === 'RECIPIENT') ||
    null;
  return {
    id: doc._id,
    agreementNumber: doc.agreementNumber,
    title: doc.title,
    type: doc.type,
    status: doc.status,
    signingType: doc.signingType,
    bodyHtml: doc.bodyHtml,
    sentBy: 'Tylo Care',
    envelopeMessage: doc.envelopeMessage,
    partyName: doc.partyName,
    startDate: doc.startDate,
    endDate: doc.endDate,
    sender: sender
      ? {
          id: sender.id,
          name: sender.name,
          status: sender.status,
          signatureType: sender.signatureType,
          signatureData: sender.signatureData,
          signedAt: sender.signedAt,
          acknowledgedAt: sender.acknowledgedAt,
        }
      : null,
    receiver: receiver
      ? {
          id: receiver.id,
          name: receiver.name,
          status: receiver.status,
          signatureType: receiver.signatureType,
          signatureData: receiver.signatureData,
          signedAt: receiver.signedAt,
          acknowledgedAt: receiver.acknowledgedAt,
        }
      : null,
  };
}

async function findByToken(token) {
  return findAgreementByAccessKey(token);
}

function receiverIndex(agreement) {
  const signers = agreement.signers || [];
  let idx = signers.findIndex((s) => s.partySide === 'RECEIVER' || s.role === 'RECEIVER');
  if (idx < 0) idx = signers.findIndex((s) => s.role === 'SIGNER' || s.role === 'RECIPIENT');
  return idx;
}

router.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const agreement = await findByToken(req.params.token);
    if (!agreement) throw new AppError('Invalid or expired signing link', 404);
    if (['DRAFT', 'DECLINED', 'TERMINATED'].includes(agreement.status)) {
      throw new AppError('This document is not available for signing', 400, 'INVALID_STATUS');
    }
    const receiverIdx = receiverIndex(agreement);
    const receiver = receiverIdx >= 0 ? agreement.signers[receiverIdx] : null;
    const receiverDone =
      receiver?.status === 'SIGNED' || receiver?.status === 'ACKNOWLEDGED';
    const awaiting = ['SENT', 'PARTIALLY_SIGNED'].includes(agreement.status);
    if (!awaiting && !receiverDone && !['COMPLETED', 'ACTIVE'].includes(agreement.status)) {
      throw new AppError('This document is not awaiting your action', 400, 'INVALID_STATUS');
    }
    res.json({ data: publicAgreement(agreement) });
  })
);

router.get(
  '/:token/pdf',
  asyncHandler(async (req, res) => {
    const agreement = await findByToken(req.params.token);
    if (!agreement) throw new AppError('Invalid or expired signing link', 404);
    if (['DRAFT', 'DECLINED', 'TERMINATED'].includes(agreement.status)) {
      throw new AppError('This document is not available', 400, 'INVALID_STATUS');
    }

    const pdfBuffer = await buildAgreementPdfBuffer(agreement, pdfOptionsFromAgreement(agreement));
    const safeName = String(agreement.title || agreement.agreementNumber || 'document')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 80);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdfBuffer);
  })
);

router.post(
  '/:token/sign',
  asyncHandler(async (req, res) => {
    const agreement = await findByToken(req.params.token);
    if (!agreement) throw new AppError('Invalid or expired signing link', 404);
    if (agreement.signingType === 'NON_SIGNING') {
      throw new AppError('This document uses acknowledgment, not signature', 400, 'NON_SIGNING');
    }
    if (!['SENT', 'PARTIALLY_SIGNED'].includes(agreement.status)) {
      throw new AppError('Document is not awaiting signature', 400, 'INVALID_STATUS');
    }

    const idx = receiverIndex(agreement);
    if (idx < 0) throw new AppError('Receiver not found', 404);
    const current = agreement.signers[idx];
    if (current.status === 'SIGNED' || current.status === 'ACKNOWLEDGED') {
      throw new AppError('Already signed', 400, 'ALREADY_SIGNED');
    }

    const { signatureType, signatureData, typedName } = req.body;
    if (!signatureType || !['DRAWN', 'TYPED', 'UPLOADED'].includes(signatureType)) {
      throw new AppError('signatureType must be DRAWN, UPLOADED, or TYPED', 400, 'VALIDATION_ERROR');
    }
    if (!signatureData && (signatureType === 'DRAWN' || signatureType === 'UPLOADED')) {
      throw new AppError('signatureData required', 400, 'VALIDATION_ERROR');
    }
    if (signatureType === 'TYPED' && !typedName && !signatureData) {
      throw new AppError('typedName required', 400, 'VALIDATION_ERROR');
    }

    const resolvedData = signatureType === 'TYPED' ? typedName || signatureData : signatureData;
    const signers = [...agreement.signers];
    signers[idx] = {
      ...signers[idx],
      partySide: 'RECEIVER',
      role: 'RECEIVER',
      status: 'SIGNED',
      signedAt: new Date().toISOString(),
      signatureType,
      signatureData: resolvedData,
      ip: req.ip,
    };
    agreement.signers = signers;
    agreement.status = computeStatus(agreement);
    if (agreement.status === 'COMPLETED') agreement.completedAt = new Date().toISOString();
    await agreement.save();
    if (agreement.status === 'COMPLETED') {
      await syncLinkedAssetsFromAgreement(agreement);
    }

    await AgreementActivity.create({
      agreementId: agreement._id,
      at: new Date().toISOString(),
      actorId: null,
      actorName: current.name,
      actorEmail: current.email,
      action: 'SIGNED',
      message: `${current.name} signed via recipient link`,
      meta: { signerId: current.id, via: 'RECIPIENT_LINK' },
    });
    await writeAudit({
      actorEmail: current.email,
      action: 'AGREEMENT.RECIPIENT_SIGN',
      entityType: 'Agreement',
      entityId: agreement._id,
      after: { signerId: current.id, status: agreement.status },
      requestId: req.requestId,
    });

    res.json({ data: publicAgreement(agreement) });
  })
);

router.post(
  '/:token/acknowledge',
  asyncHandler(async (req, res) => {
    const agreement = await findByToken(req.params.token);
    if (!agreement) throw new AppError('Invalid or expired signing link', 404);
    if (agreement.signingType !== 'NON_SIGNING') {
      throw new AppError('This document requires a signature', 400, 'SIGNING_REQUIRED');
    }
    if (!['SENT', 'PARTIALLY_SIGNED'].includes(agreement.status)) {
      throw new AppError('Document is not awaiting acknowledgment', 400, 'INVALID_STATUS');
    }

    const idx = receiverIndex(agreement);
    if (idx < 0) throw new AppError('Receiver not found', 404);
    const current = agreement.signers[idx];
    if (current.status === 'ACKNOWLEDGED' || current.status === 'SIGNED') {
      throw new AppError('Already acknowledged', 400, 'ALREADY_ACKNOWLEDGED');
    }

    const acknowledgedAt = new Date().toISOString();
    const signers = [...agreement.signers];
    signers[idx] = {
      ...signers[idx],
      partySide: 'RECEIVER',
      role: 'RECEIVER',
      status: 'ACKNOWLEDGED',
      acknowledgedAt,
      signedAt: acknowledgedAt,
      signatureType: 'ACKNOWLEDGE',
      signatureData: `Acknowledged ${formatDateTime(acknowledgedAt)}`,
      ip: req.ip,
    };
    agreement.signers = signers;
    agreement.status = computeStatus(agreement);
    if (agreement.status === 'COMPLETED') agreement.completedAt = acknowledgedAt;
    await agreement.save();
    if (agreement.status === 'COMPLETED') {
      await syncLinkedAssetsFromAgreement(agreement);
    }

    await AgreementActivity.create({
      agreementId: agreement._id,
      at: acknowledgedAt,
      actorId: null,
      actorName: current.name,
      actorEmail: current.email,
      action: 'ACKNOWLEDGED',
      message: `${current.name} acknowledged via recipient link`,
      meta: { signerId: current.id, via: 'RECIPIENT_LINK' },
    });

    res.json({ data: publicAgreement(agreement) });
  })
);

export default router;
