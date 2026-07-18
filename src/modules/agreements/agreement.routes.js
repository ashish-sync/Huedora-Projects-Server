import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { randomBytes } from 'crypto';
import { authenticate, requirePermission, hasPermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { env } from '../../config/env.js';
import {
  Agreement,
  AgreementAsset,
  AgreementDocument,
  AgreementActivity,
} from './agreement.model.js';
import { Asset } from '../assets/asset.model.js';
import { Contact } from '../contacts/contact.model.js';
import { DocumentTemplate } from '../templates/template.model.js';
import { SignatureMaster } from '../signatures/signature.model.js';
import { previewStore } from '../templates/previewStore.js';
import { nextSequence } from '../../utils/counters.js';
import { writeAudit } from '../../utils/audit.js';
import { AssetEvent } from '../assets/assetEvent.model.js';
import { syncAssetContactFromAgreement } from '../assets/assetContactSync.js';
import { Notification } from '../notifications/notification.model.js';
import { ensureRecipientShortCode, generateShortCode } from './recipientAccess.js';
import { buildAgreementPdfBuffer, pdfOptionsFromAgreement } from './agreementPdf.js';
import { sendExcel } from '../../utils/excelExport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.resolve(__dirname, '../../../uploads/agreements');
const previewRoot = path.resolve(__dirname, '../../../uploads/previews');
fs.mkdirSync(uploadRoot, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadRoot),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${uuid()}-${safe}`);
    },
  }),
  limits: { fileSize: env.uploadMaxBytes },
});

const router = Router();
router.use(authenticate);

async function logActivity(agreementId, req, action, message, meta = null) {
  await AgreementActivity.create({
    agreementId,
    at: new Date().toISOString(),
    actorId: req.user._id,
    actorName: req.user.fullName,
    actorEmail: req.user.email,
    action,
    message,
    meta,
  });
}

function signerSummary(signers = []) {
  const total = signers.length;
  const signed = signers.filter((s) => s.status === 'SIGNED' || s.status === 'ACKNOWLEDGED').length;
  const declined = signers.filter((s) => s.status === 'DECLINED').length;
  return { total, signed, declined };
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

function computeStatus(agreement) {
  const signers = agreement.signers || [];
  if (agreement.status === 'ACTIVE' || agreement.status === 'TERMINATED') return agreement.status;
  if (signers.some((s) => s.status === 'DECLINED')) return 'DECLINED';

  const sender = partySigner(signers, 'SENDER');
  const receiver =
    partySigner(signers, 'RECEIVER') ||
    signers.find((s) => s.role === 'SIGNER' || s.role === 'RECIPIENT');

  if (agreement.signingType === 'NON_SIGNING') {
    if (receiver && isDone(receiver)) return 'COMPLETED';
    if (agreement.sentAt) return 'SENT';
    return agreement.status || 'DRAFT';
  }

  if (sender && receiver) {
    if (isDone(sender) && isDone(receiver)) return 'COMPLETED';
    if (isDone(sender) || isDone(receiver)) return 'PARTIALLY_SIGNED';
    if (agreement.sentAt) return 'SENT';
    return agreement.status || 'DRAFT';
  }

  const { total, signed } = signerSummary(signers);
  if (total > 0 && signed === total) return 'COMPLETED';
  if (signed > 0 && signed < total) return 'PARTIALLY_SIGNED';
  if (agreement.sentAt) return 'SENT';
  return agreement.status || 'DRAFT';
}

function ensureTwoPartySigners(agreement, req) {
  let signers = [...(agreement.signers || [])];
  let sender = partySigner(signers, 'SENDER');
  if (!sender) {
    sender = {
      id: uuid(),
      name: req.user.fullName || req.user.email,
      email: req.user.email,
      mobile: req.user.phone || '',
      role: 'SENDER',
      partySide: 'SENDER',
      order: 1,
      status: 'PENDING',
      signedAt: null,
      acknowledgedAt: null,
      signatureType: null,
      signatureData: null,
      ip: null,
    };
    signers = [sender, ...signers.map((s, i) => ({ ...s, order: i + 2 }))];
  }
  let receiver = partySigner(signers, 'RECEIVER');
  if (!receiver) {
    const legacy = signers.find((s) => s.partySide !== 'SENDER' && s.role !== 'SENDER');
    if (legacy) {
      signers = signers.map((s) =>
        s.id === legacy.id ? { ...s, partySide: 'RECEIVER', role: 'RECEIVER' } : s
      );
    }
  }
  agreement.signers = signers;
  return agreement;
}

router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const all = await Agreement.find({ isDeleted: false }).limit(500);
    const counts = {
      total: all.length,
      DRAFT: 0,
      SENT: 0,
      PARTIALLY_SIGNED: 0,
      COMPLETED: 0,
      ACTIVE: 0,
      DECLINED: 0,
      TERMINATED: 0,
      EXPIRING: 0,
      EXPIRED: 0,
      RENEWED: 0,
    };
    for (const a of all) {
      const s = a.status || 'DRAFT';
      counts[s] = (counts[s] || 0) + 1;
    }
    res.json({ data: counts });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.status) {
      const statuses = String(req.query.status)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      filter.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
    }
    if (req.query.type) filter.type = req.query.type;
    if (req.query.q) {
      const q = String(req.query.q);
      filter.$or = [
        { agreementNumber: new RegExp(q, 'i') },
        { partyName: new RegExp(q, 'i') },
        { title: new RegExp(q, 'i') },
        { partyEmail: new RegExp(q, 'i') },
      ];
    }
    const [data, total] = await Promise.all([
      Agreement.find(filter).sort(sort || '-updatedAt').skip(skip).limit(limit),
      Agreement.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const filter = { isDeleted: false };
    if (req.query.status) {
      const statuses = String(req.query.status)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      filter.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
    }
    if (req.query.type) filter.type = req.query.type;
    if (req.query.q) {
      const q = String(req.query.q);
      filter.$or = [
        { agreementNumber: new RegExp(q, 'i') },
        { partyName: new RegExp(q, 'i') },
        { title: new RegExp(q, 'i') },
        { partyEmail: new RegExp(q, 'i') },
      ];
    }
    const rows = await Agreement.find(filter).sort('-updatedAt');
    sendExcel(
      res,
      'Agreements.xlsx',
      [
        'Agreement Number',
        'Title',
        'Type',
        'Status',
        'Party Name',
        'Party Email',
        'Start Date',
        'End Date',
        'Updated At',
      ],
      rows.map((a) => [
        a.agreementNumber,
        a.title,
        a.type,
        a.status,
        a.partyName,
        a.partyEmail,
        a.startDate,
        a.endDate,
        a.updatedAt,
      ]),
      { sheetName: 'Agreements' }
    );
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    let agreement = await Agreement.findOne({ _id: req.params.id, isDeleted: false });
    if (!agreement) throw new AppError('Agreement not found', 404);
    if (agreement.recipientAccessToken) {
      agreement = await ensureRecipientShortCode(agreement);
    }
    const [links, documents, activity] = await Promise.all([
      AgreementAsset.find({ agreementId: agreement._id, isActive: true }).populate('assetId'),
      AgreementDocument.find({ agreementId: agreement._id, isDeleted: false }).sort('-createdAt'),
      AgreementActivity.find({ agreementId: agreement._id }).sort('-at').limit(100),
    ]);
    res.json({
      data: {
        ...agreement.toObject(),
        assets: links,
        documents,
        activity,
        signerStats: signerSummary(agreement.signers),
      },
    });
  })
);

router.post(
  '/',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    let contact = null;

    if (body.contactId) {
      contact = await Contact.findOne({ _id: body.contactId, isDeleted: false });
      if (!contact) throw new AppError('Selected contact not found', 404);
    } else if (body.saveContact === 'true' || body.saveContact === true || body.name) {
      const name = body.contactName || body.name || body.partyName;
      const email = body.contactEmail || body.email || body.partyEmail;
      const mobile = body.contactMobile || body.contact || body.mobile || body.partyMobile;
      const resourceType = body.resourceType || body.contactResourceType || '';
      const profession = body.profession || body.contactProfession || '';
      if (!name) throw new AppError('Recipient name is required', 400, 'VALIDATION_ERROR');
      if (!email && !mobile) {
        throw new AppError('Recipient email or contact is required for delivery', 400, 'VALIDATION_ERROR');
      }
      if (email) {
        contact = await Contact.findOne({
          email: String(email).toLowerCase().trim(),
          isDeleted: false,
        });
      }
      if (!contact) {
        contact = await Contact.create({
          name: String(name).trim(),
          email: email ? String(email).toLowerCase().trim() : '',
          contact: mobile ? String(mobile).trim() : '',
          mobile: mobile ? String(mobile).trim() : '',
          resourceType: String(resourceType).trim(),
          profession: String(profession).trim(),
          state: body.contactState || body.state || '',
          city: body.contactCity || body.city || '',
          createdBy: req.user._id,
          updatedBy: req.user._id,
        });
      }
    }

    const partyName = contact?.name || body.partyName;
    const partyEmail = contact?.email || body.partyEmail || '';
    const partyMobile = contact?.contact || contact?.mobile || body.partyMobile || '';
    if (!partyName) throw new AppError('Recipient is required', 400, 'VALIDATION_ERROR');

    let bodyHtml = body.bodyHtml || '';
    let templateId = body.templateId || null;
    let documentSource = body.documentSource || (req.file ? 'UPLOAD' : 'TEMPLATE');
    let type = body.type || 'LEASE';
    let title = body.title || '';
    let signingType =
      body.signingType === 'NON_SIGNING' || body.signingType === 'non_signing'
        ? 'NON_SIGNING'
        : 'SIGNING';
    let previewEntry = null;
    let defaultSenderSignatureId = null;

    if (body.previewToken) {
      previewEntry = previewStore.get(body.previewToken);
      if (!previewEntry || previewEntry.expires < Date.now()) {
        throw new AppError('PDF preview expired. Fill placeholders again.', 400, 'PREVIEW_EXPIRED');
      }
      bodyHtml = previewEntry.filledText || bodyHtml;
      templateId = previewEntry.templateId || templateId;
      title = title || previewEntry.title;
      documentSource = 'TEMPLATE';
    }

    if (templateId) {
      const tpl = await DocumentTemplate.findOne({ _id: templateId, isDeleted: false, isActive: true });
      if (!tpl) throw new AppError('Template not found', 404);
      if ((tpl.placeholders || []).length && !previewEntry) {
        throw new AppError(
          'This template has placeholders. Fill them and preview the PDF before creating.',
          400,
          'PLACEHOLDERS_REQUIRED'
        );
      }
      bodyHtml = bodyHtml || tpl.bodyHtml;
      type = body.type || tpl.agreementType || type;
      title = title || tpl.name;
      documentSource = 'TEMPLATE';
      if (tpl.signingType === 'NON_SIGNING' || tpl.signingType === 'SIGNING') {
        signingType = tpl.signingType;
      }
      if (tpl.defaultSenderSignatureId) {
        defaultSenderSignatureId = tpl.defaultSenderSignatureId;
      }
    }

    if (req.file) {
      documentSource = 'UPLOAD';
      if (!title) title = req.file.originalname.replace(/\.[^.]+$/, '');
    }

    if (!title) throw new AppError('Document title is required', 400, 'VALIDATION_ERROR');
    if (!bodyHtml && !req.file && !previewEntry) {
      throw new AppError('Upload a document or select a template', 400, 'VALIDATION_ERROR');
    }

    const deliverEmail = body.deliverEmail === 'false' ? false : Boolean(partyEmail);
    const deliverSms = body.deliverSms === 'true' || body.deliverSms === true;

    const signers = [
      {
        id: uuid(),
        name: req.user.fullName || req.user.email,
        email: req.user.email,
        mobile: req.user.phone || '',
        role: 'SENDER',
        partySide: 'SENDER',
        order: 1,
        status: 'PENDING',
        signedAt: null,
        acknowledgedAt: null,
        signatureType: null,
        signatureData: null,
        ip: null,
      },
      {
        id: uuid(),
        name: partyName,
        email: partyEmail,
        mobile: partyMobile,
        role: 'RECEIVER',
        partySide: 'RECEIVER',
        order: 2,
        status: 'PENDING',
        signedAt: null,
        acknowledgedAt: null,
        signatureType: null,
        signatureData: null,
        ip: null,
      },
    ];

    const agreement = await Agreement.create({
      agreementNumber: await nextSequence('agreementNumber', 'AGR'),
      type,
      title,
      partyName,
      partyEmail,
      partyMobile,
      partyContact: partyMobile,
      partyState: contact?.state || body.contactState || body.state || '',
      partyCity: contact?.city || body.contactCity || body.city || '',
      contactId: contact?._id || null,
      templateId,
      defaultSenderSignatureId,
      documentSource,
      signingType,
      deliveryChannels: { email: deliverEmail, sms: deliverSms },
      deliveryStatus: {
        email: deliverEmail ? 'QUEUED' : 'SKIPPED',
        sms: deliverSms ? 'QUEUED' : 'SKIPPED',
      },
      startDate: body.startDate || null,
      endDate: body.endDate || null,
      bodyHtml,
      termsSummary: body.termsSummary || '',
      envelopeMessage:
        body.envelopeMessage ||
        (signingType === 'NON_SIGNING'
          ? 'Please review and acknowledge this document.'
          : 'Please review and sign this agreement.'),
      signers,
      status: 'DRAFT',
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    let hasPrimary = false;

    if (previewEntry?.pdfPath && fs.existsSync(previewEntry.pdfPath)) {
      const pdfKey = `${uuid()}-preview.pdf`;
      fs.copyFileSync(previewEntry.pdfPath, path.join(uploadRoot, pdfKey));
      await AgreementDocument.create({
        agreementId: agreement._id,
        name: `${title}.pdf`,
        docKind: 'CONTRACT',
        contentType: 'application/pdf',
        sizeBytes: fs.statSync(path.join(uploadRoot, pdfKey)).size,
        storageKey: pdfKey,
        textContent: bodyHtml || '',
        isPrimary: true,
        uploadedBy: req.user._id,
      });
      hasPrimary = true;

      if (previewEntry.filledDocxKey) {
        const src = path.join(previewRoot, previewEntry.filledDocxKey);
        if (fs.existsSync(src)) {
          const docxKey = `${uuid()}-filled.docx`;
          fs.copyFileSync(src, path.join(uploadRoot, docxKey));
          await AgreementDocument.create({
            agreementId: agreement._id,
            name: `${title}-filled.docx`,
            docKind: 'ATTACHMENT',
            contentType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sizeBytes: fs.statSync(path.join(uploadRoot, docxKey)).size,
            storageKey: docxKey,
            isPrimary: false,
            uploadedBy: req.user._id,
          });
        }
      }
      previewStore.delete(body.previewToken);
    } else if (bodyHtml) {
      await AgreementDocument.create({
        agreementId: agreement._id,
        name: `${title}.txt`,
        docKind: 'CONTRACT',
        contentType: 'text/plain',
        textContent: bodyHtml,
        isPrimary: true,
        sizeBytes: Buffer.byteLength(String(bodyHtml), 'utf8'),
        uploadedBy: req.user._id,
      });
      hasPrimary = true;
    }

    if (req.file) {
      await AgreementDocument.create({
        agreementId: agreement._id,
        name: req.file.originalname,
        docKind: hasPrimary ? 'ATTACHMENT' : 'CONTRACT',
        contentType: req.file.mimetype,
        sizeBytes: req.file.size,
        storageKey: req.file.filename,
        isPrimary: !hasPrimary,
        uploadedBy: req.user._id,
      });
    }

    // Delivery stubs (email/SMS). queued + activity logged; SMTP/SMS providers wired later
    const deliveryNotes = [];
    if (deliverEmail && partyEmail) {
      agreement.deliveryStatus = {
        ...agreement.deliveryStatus,
        email: env.smtpEnabled ? 'SENT' : 'QUEUED',
      };
      deliveryNotes.push(`Email → ${partyEmail} (${agreement.deliveryStatus.email})`);
    }
    if (deliverSms && partyMobile) {
      agreement.deliveryStatus = {
        ...agreement.deliveryStatus,
        sms: 'QUEUED',
      };
      deliveryNotes.push(`SMS → ${partyMobile} (QUEUED)`);
    }
    await agreement.save();

    await logActivity(
      agreement._id,
      req,
      'CREATED',
      `Created document ${agreement.agreementNumber} for ${partyName}`
    );
    if (deliveryNotes.length) {
      await logActivity(agreement._id, req, 'DELIVERY_QUEUED', deliveryNotes.join(' · '));
    }

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'AGREEMENT.CREATE',
      entityType: 'Agreement',
      entityId: agreement._id,
      after: agreement.toObject(),
      requestId: req.requestId,
    });

    res.status(201).json({ data: agreement });
  })
);

router.patch(
  '/:id',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const agreement = await Agreement.findOne({ _id: req.params.id, isDeleted: false });
    if (!agreement) throw new AppError('Agreement not found', 404);
    if (['COMPLETED', 'ACTIVE', 'TERMINATED'].includes(agreement.status) && req.body.bodyHtml) {
      throw new AppError('Cannot edit document body after completion', 400, 'LOCKED');
    }

    const fields = [
      'title',
      'type',
      'partyName',
      'partyEmail',
      'partyContact',
      'startDate',
      'endDate',
      'bodyHtml',
      'termsSummary',
      'envelopeMessage',
      'commercialNotes',
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) agreement[f] = req.body[f];
    }
    agreement.updatedBy = req.user._id;
    await agreement.save();

    if (req.body.bodyHtml !== undefined) {
      const primary = await AgreementDocument.findOne({
        agreementId: agreement._id,
        isPrimary: true,
        isDeleted: false,
      });
      if (primary) {
        primary.textContent = req.body.bodyHtml;
        primary.sizeBytes = Buffer.byteLength(String(req.body.bodyHtml), 'utf8');
        await primary.save();
      }
    }

    await logActivity(agreement._id, req, 'UPDATED', 'Document details updated');
    res.json({ data: agreement });
  })
);

router.post(
  '/:id/signers',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const agreement = await Agreement.findOne({ _id: req.params.id, isDeleted: false });
    if (!agreement) throw new AppError('Agreement not found', 404);
    if (['ACTIVE', 'TERMINATED', 'COMPLETED'].includes(agreement.status)) {
      throw new AppError('Cannot change signers in current status', 400, 'LOCKED');
    }
    const { name, email, role } = req.body;
    if (!name || !email) throw new AppError('Signer name and email required', 400, 'VALIDATION_ERROR');
    const signers = [...(agreement.signers || [])];
    signers.push({
      id: uuid(),
      name,
      email,
      role: role || 'SIGNER',
      order: signers.length + 1,
      status: 'PENDING',
      signedAt: null,
      signatureType: null,
      signatureData: null,
      ip: null,
    });
    agreement.signers = signers;
    if (agreement.status === 'SENT' || agreement.status === 'PARTIALLY_SIGNED') {
      // keep
    } else {
      agreement.status = 'DRAFT';
    }
    await agreement.save();
    await logActivity(agreement._id, req, 'SIGNER_ADDED', `Added signer ${name} <${email}>`);
    res.json({ data: agreement });
  })
);

router.post(
  '/:id/send',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    let agreement = await Agreement.findOne({ _id: req.params.id, isDeleted: false });
    if (!agreement) throw new AppError('Agreement not found', 404);
    agreement = ensureTwoPartySigners(agreement, req);

    if (!(agreement.signers || []).length) {
      throw new AppError('Add a receiver before sending', 400, 'VALIDATION_ERROR');
    }
    if (!agreement.bodyHtml && !(await AgreementDocument.countDocuments({ agreementId: agreement._id, isDeleted: false }))) {
      throw new AppError('Add document content or upload a file before sending', 400, 'VALIDATION_ERROR');
    }

    const sender = partySigner(agreement.signers, 'SENDER');
    if (agreement.signingType === 'SIGNING') {
      if (!sender || sender.status !== 'SIGNED') {
        throw new AppError(
          'Sign as the document owner before sending to the receiver',
          400,
          'SENDER_SIGN_REQUIRED'
        );
      }
    }

    const token = agreement.recipientAccessToken || randomBytes(24).toString('hex');
    agreement.recipientAccessToken = token;
    if (!agreement.recipientShortCode) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = generateShortCode();
        const clash = await Agreement.findOne({ recipientShortCode: code, isDeleted: false });
        if (!clash) {
          agreement.recipientShortCode = code;
          break;
        }
      }
      if (!agreement.recipientShortCode) {
        throw new AppError('Unable to generate signing link', 500);
      }
    }
    agreement.status = sender && isDone(sender) ? 'PARTIALLY_SIGNED' : 'SENT';
    agreement.sentAt = new Date().toISOString();
    agreement.signers = (agreement.signers || []).map((s) => {
      if (s.partySide === 'SENDER' || s.role === 'SENDER') {
        return isDone(s) ? s : { ...s, status: agreement.signingType === 'NON_SIGNING' ? s.status : s.status };
      }
      if (isDone(s)) return s;
      return { ...s, partySide: s.partySide || 'RECEIVER', role: 'RECEIVER', status: 'PENDING' };
    });
    await agreement.save();

    const sentLabel =
      agreement.signingType === 'NON_SIGNING'
        ? 'Envelope sent for acknowledgment'
        : 'Envelope sent for receiver signature';
    await logActivity(agreement._id, req, 'SENT', sentLabel, {
      receiver: partySigner(agreement.signers, 'RECEIVER')?.email,
      recipientAccessToken: token,
    });
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'AGREEMENT.SEND',
      entityType: 'Agreement',
      entityId: agreement._id,
      requestId: req.requestId,
    });

    await Notification.create({
      userId: req.user._id,
      type: 'AGREEMENT_SENT',
      title: `${agreement.agreementNumber} ${
        agreement.signingType === 'NON_SIGNING' ? 'sent for acknowledgment' : 'sent for signature'
      }`,
      body: agreement.title,
      entityType: 'Agreement',
      entityId: agreement._id,
    });

    res.json({ data: { ...agreement.toObject?.() || agreement, recipientAccessToken: token } });
  })
);

router.post(
  '/:id/sign',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    let agreement = await Agreement.findOne({ _id: req.params.id, isDeleted: false });
    if (!agreement) throw new AppError('Agreement not found', 404);
    if (agreement.signingType === 'NON_SIGNING') {
      throw new AppError('This document uses acknowledgment, not signature', 400, 'NON_SIGNING');
    }
    agreement = ensureTwoPartySigners(agreement, req);

    if (!['DRAFT', 'SENT', 'PARTIALLY_SIGNED'].includes(agreement.status)) {
      throw new AppError('Document cannot be signed in its current status', 400, 'INVALID_STATUS');
    }

    const sender = partySigner(agreement.signers, 'SENDER');
    if (!sender) throw new AppError('Sender slot missing', 400, 'VALIDATION_ERROR');

    const { signerId, signatureType: rawType, signatureData: rawData, typedName, signatureMasterId } =
      req.body;

    // Staff may only apply the owner/sender signature. never the receiver's
    if (signerId && String(signerId) !== String(sender.id)) {
      throw new AppError(
        'You cannot sign on behalf of the receiver. Share their signing link instead.',
        403,
        'FORBIDDEN'
      );
    }

    const ownerOk =
      String(agreement.createdBy) === String(req.user._id) ||
      String(sender.email || '').toLowerCase() === String(req.user.email || '').toLowerCase() ||
      hasPermission(req, PERMISSIONS.ALL);
    if (!ownerOk) {
      throw new AppError('Only the document owner can apply the sender signature', 403, 'FORBIDDEN');
    }

    let signatureType = rawType;
    let signatureData = rawData;
    let masterId = null;

    if (signatureMasterId) {
      const master = await SignatureMaster.findOne({
        _id: signatureMasterId,
        isDeleted: false,
        isActive: true,
      });
      if (!master) throw new AppError('Stored signature not found', 404);
      const admin = hasPermission(req, PERMISSIONS.ALL);
      if (!admin && String(master.createdBy) !== String(req.user._id)) {
        throw new AppError('You can only use your own stored signature', 403, 'FORBIDDEN');
      }
      if (master.signatureType === 'UPLOADED' || master.signatureType === 'DRAWN') {
        signatureType = master.signatureType === 'UPLOADED' ? 'UPLOADED' : 'DRAWN';
      } else {
        signatureType = 'TYPED';
      }
      signatureData = master.signatureData;
      masterId = master._id;
    }

    if (!signatureType || !['DRAWN', 'TYPED', 'UPLOADED'].includes(signatureType)) {
      throw new AppError('signatureType must be DRAWN, UPLOADED, or TYPED', 400, 'VALIDATION_ERROR');
    }
    if (!signatureData && (signatureType === 'DRAWN' || signatureType === 'UPLOADED')) {
      throw new AppError('signatureData required for image signature', 400, 'VALIDATION_ERROR');
    }
    if (signatureType === 'TYPED' && !typedName && !signatureData) {
      throw new AppError('typedName required', 400, 'VALIDATION_ERROR');
    }

    const signers = [...(agreement.signers || [])];
    const idx = signers.findIndex((s) => String(s.id) === String(sender.id));
    if (idx < 0) throw new AppError('Sender not found', 404);
    if (signers[idx].status === 'SIGNED') {
      throw new AppError('Sender already signed', 400, 'ALREADY_SIGNED');
    }

    const resolvedData = signatureType === 'TYPED' ? typedName || signatureData : signatureData;

    signers[idx] = {
      ...signers[idx],
      partySide: 'SENDER',
      role: 'SENDER',
      status: 'SIGNED',
      signedAt: new Date().toISOString(),
      signatureType,
      signatureData: resolvedData,
      signatureMasterId: masterId,
      ip: req.ip,
      signedByUserId: req.user._id,
    };
    agreement.signers = signers;
    agreement.status = agreement.sentAt ? computeStatus(agreement) : 'DRAFT';
    if (agreement.status === 'COMPLETED') agreement.completedAt = new Date().toISOString();
    await agreement.save();

    await logActivity(
      agreement._id,
      req,
      'SIGNED',
      `Owner ${signers[idx].name} signed (sender)${masterId ? ' · from master' : ''}`,
      { signerId: sender.id, signatureType, signatureMasterId: masterId, partySide: 'SENDER' }
    );
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'AGREEMENT.SIGN_SENDER',
      entityType: 'Agreement',
      entityId: agreement._id,
      after: { signerId: sender.id, status: agreement.status, signatureMasterId: masterId },
      requestId: req.requestId,
    });

    res.json({ data: agreement });
  })
);

router.post(
  '/:id/acknowledge',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    throw new AppError(
      'Receivers acknowledge via their secure link. Staff cannot acknowledge on their behalf.',
      403,
      'FORBIDDEN'
    );
  })
);

router.post(
  '/:id/decline',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const agreement = await Agreement.findOne({ _id: req.params.id, isDeleted: false });
    if (!agreement) throw new AppError('Agreement not found', 404);
    const { signerId, reason } = req.body;
    const signers = [...(agreement.signers || [])];
    if (signerId) {
      const idx = signers.findIndex((s) => String(s.id) === String(signerId));
      if (idx >= 0) {
        signers[idx] = { ...signers[idx], status: 'DECLINED' };
        agreement.signers = signers;
      }
    }
    agreement.status = 'DECLINED';
    agreement.declinedAt = new Date().toISOString();
    agreement.declineReason = reason || '';
    await agreement.save();
    await logActivity(agreement._id, req, 'DECLINED', reason || 'Envelope declined');
    res.json({ data: agreement });
  })
);

router.post(
  '/:id/documents',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const agreement = await Agreement.findOne({ _id: req.params.id, isDeleted: false });
    if (!agreement) throw new AppError('Agreement not found', 404);
    if (!req.file && !req.body.textContent) {
      throw new AppError('Upload a file or provide textContent', 400, 'VALIDATION_ERROR');
    }

    const doc = await AgreementDocument.create({
      agreementId: agreement._id,
      name: req.file?.originalname || req.body.name || 'Attachment',
      docKind: req.body.docKind || 'ATTACHMENT',
      contentType: req.file?.mimetype || 'text/plain',
      sizeBytes: req.file?.size || Buffer.byteLength(String(req.body.textContent || ''), 'utf8'),
      storageKey: req.file ? req.file.filename : null,
      textContent: req.body.textContent || '',
      isPrimary: req.body.isPrimary === 'true' || req.body.isPrimary === true,
      uploadedBy: req.user._id,
    });

    await logActivity(agreement._id, req, 'DOCUMENT_ADDED', `Added ${doc.name}`);
    res.status(201).json({ data: doc });
  })
);

/**
 * Live PDF preview/download for an agreement.
 * Reflects current signatures when parties have signed (signed document).
 * Use ?download=1 for attachment; default is inline preview.
 */
router.get(
  '/:id/pdf',
  asyncHandler(async (req, res) => {
    const agreement = await Agreement.findOne({ _id: req.params.id, isDeleted: false });
    if (!agreement) throw new AppError('Agreement not found', 404);

    const pdfBuffer = await buildAgreementPdfBuffer(agreement, pdfOptionsFromAgreement(agreement));

    const safeName = String(agreement.title || agreement.agreementNumber || 'agreement')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(0, 80);
    const asDownload = String(req.query.download || '') === '1';
    const suffix = ['COMPLETED', 'ACTIVE'].includes(agreement.status) ? '-signed' : '';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${asDownload ? 'attachment' : 'inline'}; filename="${safeName}${suffix}.pdf"`
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdfBuffer);
  })
);

router.get(
  '/:id/documents/:docId/download',
  asyncHandler(async (req, res) => {
    const doc = await AgreementDocument.findOne({
      _id: req.params.docId,
      agreementId: req.params.id,
      isDeleted: false,
    });
    if (!doc) throw new AppError('Document not found', 404);
    if (doc.storageKey) {
      const full = path.join(uploadRoot, doc.storageKey);
      if (!fs.existsSync(full)) throw new AppError('File missing', 404);
      return res.download(full, doc.name);
    }
    res.type('text/plain').send(doc.textContent || '');
  })
);

router.post(
  '/:id/activate',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const agreement = await Agreement.findOne({ _id: req.params.id, isDeleted: false });
    if (!agreement) throw new AppError('Agreement not found', 404);
    if ((agreement.signers || []).length) {
      if (agreement.signingType === 'NON_SIGNING') {
        const receiver =
          partySigner(agreement.signers, 'RECEIVER') ||
          agreement.signers.find((s) => s.role === 'SIGNER' || s.role === 'RECIPIENT');
        if (!receiver || !isDone(receiver)) {
          throw new AppError('Complete receiver acknowledgment before activating', 400, 'NOT_SIGNED');
        }
      } else {
        const stats = signerSummary(agreement.signers);
        if (stats.signed < stats.total) {
          throw new AppError('Complete all signatures before activating', 400, 'NOT_SIGNED');
        }
      }
    }
    agreement.status = 'ACTIVE';
    agreement.activatedAt = new Date().toISOString();
    agreement.updatedBy = req.user._id;
    await agreement.save();
    const links = await AgreementAsset.find({ agreementId: agreement._id, isActive: true });
    for (const link of links) {
      const asset = await Asset.findOne({ _id: link.assetId, isDeleted: false });
      if (!asset) continue;
      asset.activeAgreementId = agreement._id;
      asset.agreementStatus = 'Agreement Signed';
      await syncAssetContactFromAgreement(asset, agreement);
      await asset.save();
    }
    await logActivity(agreement._id, req, 'ACTIVATED', 'Agreement activated');
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'AGREEMENT.ACTIVATE',
      entityType: 'Agreement',
      entityId: agreement._id,
      requestId: req.requestId,
    });
    res.json({ data: agreement });
  })
);

router.post(
  '/:id/terminate',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const agreement = await Agreement.findOne({ _id: req.params.id, isDeleted: false });
    if (!agreement) throw new AppError('Agreement not found', 404);
    agreement.status = 'TERMINATED';
    agreement.updatedBy = req.user._id;
    await agreement.save();
    const links = await AgreementAsset.find({ agreementId: agreement._id, isActive: true });
    for (const link of links) {
      link.isActive = false;
      link.unlinkedAt = new Date();
      await link.save();
      await Asset.updateOne(
        { _id: link.assetId, activeAgreementId: agreement._id },
        { $set: { activeAgreementId: null, agreementStatus: 'Not Initiated' } }
      );
    }
    await logActivity(agreement._id, req, 'TERMINATED', 'Agreement terminated');
    res.json({ data: agreement });
  })
);

router.post(
  '/:id/assets',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE),
  asyncHandler(async (req, res) => {
    const agreement = await Agreement.findOne({ _id: req.params.id, isDeleted: false });
    if (!agreement) throw new AppError('Agreement not found', 404);
    const assetIds = req.body.assetIds || [];
    if (!assetIds.length) throw new AppError('assetIds required', 400, 'VALIDATION_ERROR');

    const linked = [];
    for (const assetId of assetIds) {
      const asset = await Asset.findOne({ _id: assetId, isDeleted: false });
      if (!asset) throw new AppError(`Asset ${assetId} not found`, 404);
      const existing = await AgreementAsset.findOne({ assetId, isActive: true });
      if (existing && String(existing.agreementId) !== String(agreement._id)) {
        throw new AppError('Asset already has an active agreement', 400, 'AGREEMENT_CONFLICT');
      }
      if (!existing) {
        const link = await AgreementAsset.create({ agreementId: agreement._id, assetId });
        linked.push(link);
        if (agreement.status === 'ACTIVE') {
          asset.activeAgreementId = agreement._id;
          asset.agreementStatus = 'Agreement Signed';
          await syncAssetContactFromAgreement(asset, agreement);
          await asset.save();
        }
        await AssetEvent.create({
          assetId,
          eventType: 'AGREEMENT_LINK',
          relatedEntityType: 'Agreement',
          relatedEntityId: agreement._id,
          actorId: req.user._id,
          reason: 'Linked to agreement',
        });
      }
    }
    await logActivity(agreement._id, req, 'ASSET_LINKED', `Linked ${linked.length} asset(s)`);
    res.status(201).json({ data: linked });
  })
);

export default router;
