import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { authenticate, requirePermission, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { writeAudit } from '../../utils/audit.js';
import { nextSequence } from '../../utils/counters.js';
import { FinanceCommercialDocument } from './finance.model.js';
import { COMMERCIAL_DOC_STATUSES } from './finance.constants.js';
import { DOCUMENT_NUMBER_STANDARDS, documentNumberPeriod, validateManualDocumentNumber } from './documentNumbering.js';
import {
  assertApprovable,
  assertCancellable,
  assertEditableStatus,
  assertIssuable,
  assertRejectable,
  assertSubmittable,
  extractBuilderExtras,
  fiscalYearLabel,
  getOrCreateOrgProfile,
  mergeOrgProfile,
  nextProformaNumber,
  nextPurchaseOrderNumber,
  normalizeClientInvoicePayload,
  normalizeCreditNotePayload,
  normalizeProformaPayload,
  normalizePurchaseOrderPayload,
  nextClientInvoiceNumber,
  nextCreditNoteNumber,
  toAmount,
  todayIso,
  trimStr,
  validateClientInvoicePayload,
  validateCreditNotePayload,
  validateProformaPayload,
  validatePurchaseOrderPayload,
  usesIgst,
} from './financeCommercial.service.js';
import { buildProformaPdfBuffer } from './proformaPdf.js';
import { buildPurchaseOrderPdfBuffer } from './purchaseOrderPdf.js';
import { buildClientInvoicePdfBuffer } from './clientInvoicePdf.js';
import { buildCreditNotePdfBuffer } from './creditNotePdf.js';
import { uploadDir } from '../../config/paths.js';
import { escapeRegex } from '../../utils/escapeRegex.js';

const uploadRoot = uploadDir('finance');

const ALLOWED_COMMERCIAL_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const ALLOWED_COMMERCIAL_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.pdf';
    cb(null, `${uuid()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.uploadMaxBytes },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const okMime = ALLOWED_COMMERCIAL_MIMES.has(file.mimetype);
    const okExt = ALLOWED_COMMERCIAL_EXTENSIONS.has(ext);
    if (!okMime || !okExt) {
      return cb(new AppError('Only PDF, Word, or Excel files are allowed', 400, 'INVALID_FILE'));
    }
    cb(null, true);
  },
});

const router = Router();
router.use(authenticate);

const canRead = requirePermission(PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_WRITE);
const canWrite = requirePermission(PERMISSIONS.FINANCE_WRITE);

const COMMERCIAL_DOC_TYPES = ['client_invoice', 'purchase_order', 'proforma', 'credit_note'];

function commercialListFilter(req) {
  const filter = { isDeleted: false };
  const type = trimStr(req.query.documentType);
  if (type && COMMERCIAL_DOC_TYPES.includes(type)) {
    filter.documentType = type;
  } else {
    filter.documentType = { $in: COMMERCIAL_DOC_TYPES };
  }
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.q) {
    const re = new RegExp(escapeRegex(String(req.query.q)), 'i');
    filter.$or = [
      { docKey: re },
      { documentNumber: re },
      { recipientName: re },
      { projectName: re },
    ];
  }
  return filter;
}

function sendPreviewPdf(res, pdfBuffer, filename = 'preview.pdf') {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.send(pdfBuffer);
}

router.get(
  '/commercial-documents',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = commercialListFilter(req);
    const [data, total] = await Promise.all([
      FinanceCommercialDocument.find(filter)
        .sort(sort || '-documentDate')
        .skip(skip)
        .limit(limit),
      FinanceCommercialDocument.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

async function loadCommercialById(id) {
  const row = await FinanceCommercialDocument.findOne({ _id: id, isDeleted: false });
  if (!row) throw new AppError('Document not found', 404);
  return row;
}

function auditCommercial(req, action, row, before = null) {
  return writeAudit({
    actorId: req.user._id,
    actorEmail: req.user.email,
    action,
    entityType: 'FinanceCommercialDocument',
    entityId: row._id,
    before,
    after: row.toObject ? row.toObject() : row,
    requestId: req.requestId,
  });
}

function stampUpdater(row, user) {
  row.updatedById = user._id;
  row.updatedByEmail = user.email;
}

router.get(
  '/commercial-documents/:id',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await loadCommercialById(req.params.id);
    res.json({ data: row });
  })
);

router.post(
  '/commercial-documents/:id/submit',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await loadCommercialById(req.params.id);
    assertSubmittable(row.status);
    const orgProfile = await getOrCreateOrgProfile();
    const normalizers = {
      proforma: [normalizeProformaPayload, validateProformaPayload],
      client_invoice: [normalizeClientInvoicePayload, validateClientInvoicePayload],
      purchase_order: [normalizePurchaseOrderPayload, validatePurchaseOrderPayload],
      credit_note: [normalizeCreditNotePayload, validateCreditNotePayload],
    };
    const pair = normalizers[row.documentType];
    if (!pair) throw new AppError('Unsupported document type', 400);
    const [normalize, validate] = pair;
    const payload = normalize(row.toObject(), orgProfile);
    validate(payload);
    Object.assign(row, payload);
    const before = row.toObject ? row.toObject() : { ...row };
    row.status = 'Submitted';
    row.submittedAt = new Date().toISOString();
    row.submittedById = req.user._id;
    row.submittedByEmail = req.user.email;
    stampUpdater(row, req.user);
    await row.save();
    await auditCommercial(req, 'FINANCE.COMMERCIAL.SUBMIT', row, before);
    res.json({ data: row });
  })
);

router.post(
  '/commercial-documents/:id/approve',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await loadCommercialById(req.params.id);
    assertApprovable(row.status);
    const before = row.toObject ? row.toObject() : { ...row };
    row.status = 'Approved';
    row.approvedAt = new Date().toISOString();
    row.approvedById = req.user._id;
    row.approvedByEmail = req.user.email;
    stampUpdater(row, req.user);
    await row.save();
    await auditCommercial(req, 'FINANCE.COMMERCIAL.APPROVE', row, before);
    res.json({ data: row });
  })
);

router.post(
  '/commercial-documents/:id/reject',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await loadCommercialById(req.params.id);
    assertRejectable(row.status);
    const before = row.toObject ? row.toObject() : { ...row };
    row.status = 'Draft';
    row.submittedAt = null;
    row.submittedById = null;
    row.submittedByEmail = '';
    stampUpdater(row, req.user);
    await row.save();
    await auditCommercial(req, 'FINANCE.COMMERCIAL.REJECT', row, before);
    res.json({ data: row });
  })
);

router.post(
  '/commercial-documents/:id/cancel',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await loadCommercialById(req.params.id);
    assertCancellable(row.status);
    const before = row.toObject ? row.toObject() : { ...row };
    row.status = 'Cancelled';
    row.cancelledAt = new Date().toISOString();
    row.cancelledById = req.user._id;
    row.cancelledByEmail = req.user.email;
    stampUpdater(row, req.user);
    await row.save();
    await auditCommercial(req, 'FINANCE.COMMERCIAL.CANCEL', row, before);
    res.json({ data: row });
  })
);

router.delete(
  '/commercial-documents/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await loadCommercialById(req.params.id);
    if (!['Draft', 'Uploaded', 'Cancelled'].includes(row.status)) {
      throw new AppError('Only draft, uploaded, or cancelled documents can be deleted', 400);
    }
    const before = row.toObject ? row.toObject() : { ...row };
    row.isDeleted = true;
    row.deletedAt = new Date().toISOString();
    row.deletedBy = req.user._id;
    stampUpdater(row, req.user);
    await row.save();
    await auditCommercial(req, 'FINANCE.COMMERCIAL.DELETE', row, before);
    res.json({ data: { ok: true } });
  })
);

router.get(
  '/org-profile',
  canRead,
  asyncHandler(async (_req, res) => {
    const profile = await getOrCreateOrgProfile();
    res.json({ data: profile });
  })
);

router.patch(
  '/org-profile',
  canWrite,
  asyncHandler(async (req, res) => {
    const profile = await getOrCreateOrgProfile();
    Object.assign(profile, mergeOrgProfile(req.body));
    profile.updatedById = req.user._id;
    profile.updatedByEmail = req.user.email;
    await profile.save();
    res.json({ data: profile });
  })
);

router.get(
  '/proformas',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false, documentType: 'proforma' };
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.q) {
      const re = new RegExp(escapeRegex(String(req.query.q)), 'i');
      filter.$or = [
        { docKey: re },
        { documentNumber: re },
        { recipientName: re },
        { projectName: re },
      ];
    }
    const [data, total] = await Promise.all([
      FinanceCommercialDocument.find(filter)
        .sort(sort || '-documentDate')
        .skip(skip)
        .limit(limit),
      FinanceCommercialDocument.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/proformas/:id',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'proforma',
    });
    if (!row) throw new AppError('Proforma not found', 404);
    res.json({ data: row });
  })
);

router.post(
  '/proformas',
  canWrite,
  asyncHandler(async (req, res) => {
    const orgProfile = await getOrCreateOrgProfile();
    const payload = normalizeProformaPayload(req.body, orgProfile);
    validateProformaPayload(payload, { requireLines: false });

    let documentNumber = trimStr(req.body.documentNumber);
    if (documentNumber) {
      documentNumber = validateManualDocumentNumber(documentNumber, 'proforma');
    }

    const row = await FinanceCommercialDocument.create({
      docKey: await nextSequence('financeCommercialDoc', 'PF'),
      documentType: 'proforma',
      documentNumber,
      status: 'Draft',
      source: 'generated',
      createdById: req.user._id,
      createdByEmail: req.user.email,
      ...payload,
      ...extractBuilderExtras(req.body),
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'FINANCE.PROFORMA.CREATE',
      entityType: 'FinanceCommercialDocument',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.status(201).json({ data: row });
  })
);

router.patch(
  '/proformas/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'proforma',
    });
    if (!row) throw new AppError('Proforma not found', 404);
    assertEditableStatus(row.status);

    const orgProfile = await getOrCreateOrgProfile();
    const merged = {
      ...row.toObject(),
      ...req.body,
      documentDate: req.body.documentDate != null ? req.body.documentDate : row.documentDate,
      lineItems: req.body.lineItems != null ? req.body.lineItems : row.lineItems,
    };
    const payload = normalizeProformaPayload(merged, orgProfile);
    validateProformaPayload(payload, { requireLines: false });

    const before = row.toObject ? row.toObject() : { ...row };
    Object.assign(row, payload, extractBuilderExtras(req.body));
    if (req.body.documentNumber != null) {
      const manual = trimStr(req.body.documentNumber);
      row.documentNumber = manual ? validateManualDocumentNumber(manual, 'proforma') : '';
    }
    stampUpdater(row, req.user);
    await row.save();
    await auditCommercial(req, 'FINANCE.PROFORMA.UPDATE', row, before);
    res.json({ data: row });
  })
);

router.post(
  '/proformas/:id/issue',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'proforma',
    });
    if (!row) throw new AppError('Proforma not found', 404);
    assertIssuable(row.status);

    const orgProfile = await getOrCreateOrgProfile();
    const payload = normalizeProformaPayload(row.toObject(), orgProfile);
    validateProformaPayload(payload);
    Object.assign(row, payload);

    if (!trimStr(row.documentNumber)) {
      row.documentNumber = await nextProformaNumber(row.documentDate);
    }
    row.documentPeriod = documentNumberPeriod(row.documentDate).periodKey;
    row.status = 'Issued';
    row.issuedAt = new Date().toISOString();
    row.source = row.source || 'generated';
    await row.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'FINANCE.PROFORMA.ISSUE',
      entityType: 'FinanceCommercialDocument',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.json({ data: row });
  })
);

router.post(
  '/proformas/preview',
  canRead,
  asyncHandler(async (req, res) => {
    const orgProfile = await getOrCreateOrgProfile();
    const payload = normalizeProformaPayload(req.body, orgProfile);
    if (!payload.recipientName) payload.recipientName = 'Preview Client';
    const docObj = {
      ...payload,
      documentType: 'proforma',
      documentNumber: trimStr(req.body.documentNumber) || 'PREVIEW',
      status: 'Draft',
      taxMode: usesIgst(payload.recipientStateCode, orgProfile.stateCode) ? 'igst' : 'cgst_sgst',
    };
    sendPreviewPdf(res, await buildProformaPdfBuffer(docObj, orgProfile.toObject()), 'proforma-preview.pdf');
  })
);

router.get(
  '/proformas/:id/pdf',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'proforma',
    });
    if (!row) throw new AppError('Proforma not found', 404);

    if (row.source === 'uploaded' && row.storageKey) {
      const filePath = path.join(uploadRoot, row.storageKey);
      if (!fs.existsSync(filePath)) throw new AppError('Uploaded file missing', 404);
      const asDownload = String(req.query.download || '') === '1';
      res.setHeader('Content-Type', row.uploadedMimeType || 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${asDownload ? 'attachment' : 'inline'}; filename="${(row.uploadedFileName || row.documentNumber || 'proforma').replace(/[^\w.-]+/g, '_')}.pdf"`
      );
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const orgProfile = await getOrCreateOrgProfile();
    const docObj = row.toObject ? row.toObject() : { ...row };
    docObj.taxMode = usesIgst(docObj.recipientStateCode, orgProfile.stateCode) ? 'igst' : 'cgst_sgst';
    const pdfBuffer = await buildProformaPdfBuffer(docObj, orgProfile.toObject());
    const asDownload = String(req.query.download || '') === '1';
    const safeName = (row.documentNumber || row.docKey || 'proforma').replace(/[^\w./-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${asDownload ? 'attachment' : 'inline'}; filename="${safeName}.pdf"`
    );
    res.send(pdfBuffer);
  })
);

router.post(
  '/proformas/upload',
  canWrite,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('File is required', 400, 'VALIDATION_ERROR');
    const recipientName = trimStr(req.body.recipientName);
    if (!recipientName) throw new AppError('Recipient name is required', 400, 'VALIDATION_ERROR');

    const documentDate = trimStr(req.body.documentDate) || todayIso();
    const grandTotal = toAmount(req.body.grandTotal);
    let documentNumber = trimStr(req.body.documentNumber);
    if (documentNumber) {
      documentNumber = validateManualDocumentNumber(documentNumber, 'proforma');
    }
    const period = documentNumberPeriod(documentDate);

    const row = await FinanceCommercialDocument.create({
      docKey: await nextSequence('financeCommercialDoc', 'PF'),
      documentType: 'proforma',
      documentNumber,
      fiscalYear: fiscalYearLabel(documentDate),
      documentPeriod: period.periodKey,
      status: 'Uploaded',
      source: 'uploaded',
      recipientName,
      projectName: trimStr(req.body.projectName),
      documentDate,
      dueDate: trimStr(req.body.dueDate),
      grandTotal,
      subtotal: grandTotal,
      amountInWords: trimStr(req.body.amountInWords),
      uploadedFileName: req.file.originalname,
      uploadedMimeType: req.file.mimetype,
      storageKey: req.file.filename,
      lineItems: [],
      terms: [],
      createdById: req.user._id,
      createdByEmail: req.user.email,
    });

    res.status(201).json({ data: row });
  })
);

router.delete(
  '/proformas/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'proforma',
    });
    if (!row) throw new AppError('Proforma not found', 404);
    row.isDeleted = true;
    row.deletedAt = new Date().toISOString();
    await row.save();
    res.json({ data: { ok: true } });
  })
);

function poListFilter(req) {
  const filter = { isDeleted: false, documentType: 'purchase_order' };
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.q) {
    const re = new RegExp(escapeRegex(String(req.query.q)), 'i');
    filter.$or = [
      { docKey: re },
      { documentNumber: re },
      { recipientName: re },
      { placeOfSupply: re },
    ];
  }
  return filter;
}

router.get(
  '/purchase-orders',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = poListFilter(req);
    const [data, total] = await Promise.all([
      FinanceCommercialDocument.find(filter)
        .sort(sort || '-documentDate')
        .skip(skip)
        .limit(limit),
      FinanceCommercialDocument.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/purchase-orders/:id',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'purchase_order',
    });
    if (!row) throw new AppError('Purchase order not found', 404);
    res.json({ data: row });
  })
);

router.post(
  '/purchase-orders',
  canWrite,
  asyncHandler(async (req, res) => {
    const orgProfile = await getOrCreateOrgProfile();
    const payload = normalizePurchaseOrderPayload(req.body, orgProfile);
    validatePurchaseOrderPayload(payload, { requireLines: false });

    let documentNumber = trimStr(req.body.documentNumber);
    if (documentNumber) {
      documentNumber = validateManualDocumentNumber(documentNumber, 'purchase_order');
    }

    const row = await FinanceCommercialDocument.create({
      docKey: await nextSequence('financeCommercialDoc', 'PO'),
      documentType: 'purchase_order',
      documentNumber,
      status: 'Draft',
      source: 'generated',
      createdById: req.user._id,
      createdByEmail: req.user.email,
      ...payload,
      ...extractBuilderExtras(req.body),
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'FINANCE.PO.CREATE',
      entityType: 'FinanceCommercialDocument',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.status(201).json({ data: row });
  })
);

router.patch(
  '/purchase-orders/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'purchase_order',
    });
    if (!row) throw new AppError('Purchase order not found', 404);
    assertEditableStatus(row.status);

    const orgProfile = await getOrCreateOrgProfile();
    const merged = {
      ...row.toObject(),
      ...req.body,
      vendorName: req.body.vendorName ?? row.recipientName,
      vendorAddress: req.body.vendorAddress ?? row.placeOfSupply,
      vendorGstin: req.body.vendorGstin ?? row.recipientGstin,
      documentDate: req.body.documentDate != null ? req.body.documentDate : row.documentDate,
      dueDate: req.body.dueDate != null ? req.body.dueDate : row.dueDate,
      lineItems: req.body.lineItems != null ? req.body.lineItems : row.lineItems,
    };
    const payload = normalizePurchaseOrderPayload(merged, orgProfile);
    validatePurchaseOrderPayload(payload, { requireLines: false });

    const before = row.toObject ? row.toObject() : { ...row };
    Object.assign(row, payload, extractBuilderExtras(req.body));
    if (req.body.documentNumber != null) {
      const manual = trimStr(req.body.documentNumber);
      row.documentNumber = manual ? validateManualDocumentNumber(manual, 'purchase_order') : '';
    }
    stampUpdater(row, req.user);
    await row.save();
    await auditCommercial(req, 'FINANCE.PO.UPDATE', row, before);
    res.json({ data: row });
  })
);

router.post(
  '/purchase-orders/:id/issue',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'purchase_order',
    });
    if (!row) throw new AppError('Purchase order not found', 404);
    assertIssuable(row.status);

    const orgProfile = await getOrCreateOrgProfile();
    const payload = normalizePurchaseOrderPayload(row.toObject(), orgProfile);
    validatePurchaseOrderPayload(payload);
    Object.assign(row, payload);

    if (!trimStr(row.documentNumber)) {
      row.documentNumber = await nextPurchaseOrderNumber(row.documentDate);
    }
    row.documentPeriod = documentNumberPeriod(row.documentDate).periodKey;
    row.status = 'Issued';
    row.issuedAt = new Date().toISOString();
    await row.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'FINANCE.PO.ISSUE',
      entityType: 'FinanceCommercialDocument',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.json({ data: row });
  })
);

router.post(
  '/purchase-orders/preview',
  canRead,
  asyncHandler(async (req, res) => {
    const orgProfile = await getOrCreateOrgProfile();
    const payload = normalizePurchaseOrderPayload(req.body, orgProfile);
    if (!payload.recipientName) payload.recipientName = 'Preview Vendor';
    const docObj = {
      ...payload,
      documentType: 'purchase_order',
      documentNumber: trimStr(req.body.documentNumber) || 'PREVIEW',
      status: 'Draft',
    };
    sendPreviewPdf(res, await buildPurchaseOrderPdfBuffer(docObj, orgProfile.toObject()), 'po-preview.pdf');
  })
);

router.get(
  '/purchase-orders/:id/pdf',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'purchase_order',
    });
    if (!row) throw new AppError('Purchase order not found', 404);

    if (row.source === 'uploaded' && row.storageKey) {
      const filePath = path.join(uploadRoot, row.storageKey);
      if (!fs.existsSync(filePath)) throw new AppError('Uploaded file missing', 404);
      const asDownload = String(req.query.download || '') === '1';
      res.setHeader('Content-Type', row.uploadedMimeType || 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${asDownload ? 'attachment' : 'inline'}; filename="${(row.uploadedFileName || row.documentNumber || 'purchase-order').replace(/[^\w.-]+/g, '_')}.pdf"`
      );
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const orgProfile = await getOrCreateOrgProfile();
    const pdfBuffer = await buildPurchaseOrderPdfBuffer(row.toObject(), orgProfile.toObject());
    const asDownload = String(req.query.download || '') === '1';
    const safeName = (row.documentNumber || row.docKey || 'purchase-order').replace(/[^\w./-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${asDownload ? 'attachment' : 'inline'}; filename="${safeName}.pdf"`
    );
    res.send(pdfBuffer);
  })
);

router.post(
  '/purchase-orders/upload',
  canWrite,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('File is required', 400, 'VALIDATION_ERROR');
    const vendorName = trimStr(req.body.vendorName || req.body.recipientName);
    if (!vendorName) throw new AppError('Vendor name is required', 400, 'VALIDATION_ERROR');

    const documentDate = trimStr(req.body.documentDate) || todayIso();
    const grandTotal = toAmount(req.body.grandTotal);
    let documentNumber = trimStr(req.body.documentNumber);
    if (documentNumber) {
      documentNumber = validateManualDocumentNumber(documentNumber, 'purchase_order');
    }
    const period = documentNumberPeriod(documentDate);

    const row = await FinanceCommercialDocument.create({
      docKey: await nextSequence('financeCommercialDoc', 'PO'),
      documentType: 'purchase_order',
      documentNumber,
      fiscalYear: fiscalYearLabel(documentDate),
      documentPeriod: period.periodKey,
      status: 'Uploaded',
      source: 'uploaded',
      recipientName: vendorName,
      placeOfSupply: trimStr(req.body.vendorAddress),
      documentDate,
      dueDate: trimStr(req.body.dueDate),
      grandTotal,
      subtotal: grandTotal,
      uploadedFileName: req.file.originalname,
      uploadedMimeType: req.file.mimetype,
      storageKey: req.file.filename,
      lineItems: [],
      terms: [],
      createdById: req.user._id,
      createdByEmail: req.user.email,
    });

    res.status(201).json({ data: row });
  })
);

router.delete(
  '/purchase-orders/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'purchase_order',
    });
    if (!row) throw new AppError('Purchase order not found', 404);
    row.isDeleted = true;
    row.deletedAt = new Date().toISOString();
    await row.save();
    res.json({ data: { ok: true } });
  })
);

function clientInvoiceListFilter(req) {
  const filter = { isDeleted: false, documentType: 'client_invoice' };
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.q) {
    const re = new RegExp(escapeRegex(String(req.query.q)), 'i');
    filter.$or = [
      { docKey: re },
      { documentNumber: re },
      { recipientName: re },
      { projectName: re },
    ];
  }
  return filter;
}

router.get(
  '/client-invoices',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = clientInvoiceListFilter(req);
    const [data, total] = await Promise.all([
      FinanceCommercialDocument.find(filter)
        .sort(sort || '-documentDate')
        .skip(skip)
        .limit(limit),
      FinanceCommercialDocument.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/client-invoices/:id',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'client_invoice',
    });
    if (!row) throw new AppError('Invoice not found', 404);
    res.json({ data: row });
  })
);

router.post(
  '/client-invoices/preview',
  canRead,
  asyncHandler(async (req, res) => {
    const orgProfile = await getOrCreateOrgProfile();
    const payload = normalizeClientInvoicePayload(req.body, orgProfile);
    if (!payload.recipientName) {
      payload.recipientName = 'Preview Client';
    }
    const docObj = {
      ...payload,
      documentType: 'client_invoice',
      documentNumber: trimStr(req.body.documentNumber) || 'PREVIEW',
      status: 'Draft',
      taxMode: usesIgst(payload.recipientStateCode, orgProfile.stateCode) ? 'igst' : 'cgst_sgst',
    };
    const pdfBuffer = await buildClientInvoicePdfBuffer(docObj, orgProfile.toObject());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="invoice-preview.pdf"');
    res.send(pdfBuffer);
  })
);

router.post(
  '/client-invoices',
  canWrite,
  asyncHandler(async (req, res) => {
    const orgProfile = await getOrCreateOrgProfile();
    const payload = normalizeClientInvoicePayload(req.body, orgProfile);
    validateClientInvoicePayload(payload, { requireLines: false });

    let documentNumber = trimStr(req.body.documentNumber);
    if (documentNumber) {
      documentNumber = validateManualDocumentNumber(documentNumber, 'client_invoice');
    }

    const row = await FinanceCommercialDocument.create({
      docKey: await nextSequence('financeCommercialDoc', 'INV'),
      documentType: 'client_invoice',
      documentNumber,
      status: 'Draft',
      source: 'generated',
      createdById: req.user._id,
      createdByEmail: req.user.email,
      ...payload,
      ...extractBuilderExtras(req.body),
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'FINANCE.CLIENT_INVOICE.CREATE',
      entityType: 'FinanceCommercialDocument',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.status(201).json({ data: row });
  })
);

router.patch(
  '/client-invoices/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'client_invoice',
    });
    if (!row) throw new AppError('Invoice not found', 404);
    assertEditableStatus(row.status);

    const orgProfile = await getOrCreateOrgProfile();
    const merged = {
      ...row.toObject(),
      ...req.body,
      documentDate: req.body.documentDate != null ? req.body.documentDate : row.documentDate,
      lineItems: req.body.lineItems != null ? req.body.lineItems : row.lineItems,
    };
    const payload = normalizeClientInvoicePayload(merged, orgProfile);
    validateClientInvoicePayload(payload, { requireLines: false });

    const before = row.toObject ? row.toObject() : { ...row };
    Object.assign(row, payload, extractBuilderExtras(req.body));
    if (req.body.documentNumber != null) {
      const manual = trimStr(req.body.documentNumber);
      row.documentNumber = manual ? validateManualDocumentNumber(manual, 'client_invoice') : '';
    }
    stampUpdater(row, req.user);
    await row.save();
    await auditCommercial(req, 'FINANCE.CLIENT_INVOICE.UPDATE', row, before);
    res.json({ data: row });
  })
);

router.post(
  '/client-invoices/:id/issue',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'client_invoice',
    });
    if (!row) throw new AppError('Invoice not found', 404);
    assertIssuable(row.status);

    const orgProfile = await getOrCreateOrgProfile();
    const payload = normalizeClientInvoicePayload(row.toObject(), orgProfile);
    validateClientInvoicePayload(payload);
    Object.assign(row, payload);

    if (!trimStr(row.documentNumber)) {
      row.documentNumber = await nextClientInvoiceNumber(row.documentDate);
    }
    row.documentPeriod = documentNumberPeriod(row.documentDate).periodKey;
    row.status = 'Issued';
    row.issuedAt = new Date().toISOString();
    row.source = row.source || 'generated';
    await row.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'FINANCE.CLIENT_INVOICE.ISSUE',
      entityType: 'FinanceCommercialDocument',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.json({ data: row });
  })
);

router.get(
  '/client-invoices/:id/pdf',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'client_invoice',
    });
    if (!row) throw new AppError('Invoice not found', 404);

    if (row.source === 'uploaded' && row.storageKey) {
      const filePath = path.join(uploadRoot, row.storageKey);
      if (!fs.existsSync(filePath)) throw new AppError('Uploaded file missing', 404);
      const asDownload = String(req.query.download || '') === '1';
      res.setHeader('Content-Type', row.uploadedMimeType || 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${asDownload ? 'attachment' : 'inline'}; filename="${(row.uploadedFileName || row.documentNumber || 'invoice').replace(/[^\w.-]+/g, '_')}.pdf"`
      );
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const orgProfile = await getOrCreateOrgProfile();
    const docObj = row.toObject ? row.toObject() : { ...row };
    docObj.taxMode = usesIgst(docObj.recipientStateCode, orgProfile.stateCode) ? 'igst' : 'cgst_sgst';
    const pdfBuffer = await buildClientInvoicePdfBuffer(docObj, orgProfile.toObject());
    const asDownload = String(req.query.download || '') === '1';
    const safeName = (row.documentNumber || row.docKey || 'invoice').replace(/[^\w./-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${asDownload ? 'attachment' : 'inline'}; filename="${safeName}.pdf"`
    );
    res.send(pdfBuffer);
  })
);

router.get(
  '/credit-notes',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false, documentType: 'credit_note' };
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.q) {
      const re = new RegExp(escapeRegex(String(req.query.q)), 'i');
      filter.$or = [
        { docKey: re },
        { documentNumber: re },
        { recipientName: re },
        { projectName: re },
      ];
    }
    const [data, total] = await Promise.all([
      FinanceCommercialDocument.find(filter)
        .sort(sort || '-documentDate')
        .skip(skip)
        .limit(limit),
      FinanceCommercialDocument.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/credit-notes/:id',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'credit_note',
    });
    if (!row) throw new AppError('Credit note not found', 404);
    res.json({ data: row });
  })
);

router.post(
  '/credit-notes/preview',
  canRead,
  asyncHandler(async (req, res) => {
    const orgProfile = await getOrCreateOrgProfile();
    const payload = normalizeCreditNotePayload(req.body, orgProfile);
    if (!payload.recipientName) payload.recipientName = 'Preview Client';
    const docObj = {
      ...payload,
      documentType: 'credit_note',
      documentNumber: trimStr(req.body.documentNumber) || 'PREVIEW',
      status: 'Draft',
      taxMode: usesIgst(payload.recipientStateCode, orgProfile.stateCode) ? 'igst' : 'cgst_sgst',
    };
    sendPreviewPdf(res, await buildCreditNotePdfBuffer(docObj, orgProfile.toObject()), 'credit-note-preview.pdf');
  })
);

router.post(
  '/credit-notes',
  canWrite,
  asyncHandler(async (req, res) => {
    const orgProfile = await getOrCreateOrgProfile();
    const payload = normalizeCreditNotePayload(req.body, orgProfile);
    validateCreditNotePayload(payload, { requireLines: false });

    let documentNumber = trimStr(req.body.documentNumber);
    if (documentNumber) {
      documentNumber = validateManualDocumentNumber(documentNumber, 'credit_note');
    }

    const row = await FinanceCommercialDocument.create({
      docKey: await nextSequence('financeCommercialDoc', 'CN'),
      documentType: 'credit_note',
      documentNumber,
      status: 'Draft',
      source: 'generated',
      createdById: req.user._id,
      createdByEmail: req.user.email,
      ...payload,
      ...extractBuilderExtras(req.body),
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'FINANCE.CREDIT_NOTE.CREATE',
      entityType: 'FinanceCommercialDocument',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.status(201).json({ data: row });
  })
);

router.patch(
  '/credit-notes/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'credit_note',
    });
    if (!row) throw new AppError('Credit note not found', 404);
    assertEditableStatus(row.status);

    const orgProfile = await getOrCreateOrgProfile();
    const merged = {
      ...row.toObject(),
      ...req.body,
      documentDate: req.body.documentDate != null ? req.body.documentDate : row.documentDate,
      lineItems: req.body.lineItems != null ? req.body.lineItems : row.lineItems,
    };
    const payload = normalizeCreditNotePayload(merged, orgProfile);
    validateCreditNotePayload(payload, { requireLines: false });

    const before = row.toObject ? row.toObject() : { ...row };
    Object.assign(row, payload, extractBuilderExtras(req.body));
    if (req.body.documentNumber != null) {
      const manual = trimStr(req.body.documentNumber);
      row.documentNumber = manual ? validateManualDocumentNumber(manual, 'credit_note') : '';
    }
    stampUpdater(row, req.user);
    await row.save();
    await auditCommercial(req, 'FINANCE.CREDIT_NOTE.UPDATE', row, before);
    res.json({ data: row });
  })
);

router.post(
  '/credit-notes/:id/issue',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'credit_note',
    });
    if (!row) throw new AppError('Credit note not found', 404);
    assertIssuable(row.status);

    const orgProfile = await getOrCreateOrgProfile();
    const payload = normalizeCreditNotePayload(row.toObject(), orgProfile);
    validateCreditNotePayload(payload);
    Object.assign(row, payload);

    if (!trimStr(row.documentNumber)) {
      row.documentNumber = await nextCreditNoteNumber(row.documentDate);
    }
    row.documentPeriod = documentNumberPeriod(row.documentDate).periodKey;
    row.status = 'Issued';
    row.issuedAt = new Date().toISOString();
    row.source = row.source || 'generated';
    await row.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'FINANCE.CREDIT_NOTE.ISSUE',
      entityType: 'FinanceCommercialDocument',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.json({ data: row });
  })
);

router.get(
  '/credit-notes/:id/pdf',
  canRead,
  asyncHandler(async (req, res) => {
    const row = await FinanceCommercialDocument.findOne({
      _id: req.params.id,
      isDeleted: false,
      documentType: 'credit_note',
    });
    if (!row) throw new AppError('Credit note not found', 404);

    if (row.source === 'uploaded' && row.storageKey) {
      const filePath = path.join(uploadRoot, row.storageKey);
      if (!fs.existsSync(filePath)) throw new AppError('Uploaded file missing', 404);
      const asDownload = String(req.query.download || '') === '1';
      res.setHeader('Content-Type', row.uploadedMimeType || 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${asDownload ? 'attachment' : 'inline'}; filename="${(row.uploadedFileName || row.documentNumber || 'credit-note').replace(/[^\w.-]+/g, '_')}.pdf"`
      );
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const orgProfile = await getOrCreateOrgProfile();
    const docObj = row.toObject ? row.toObject() : { ...row };
    docObj.taxMode = usesIgst(docObj.recipientStateCode, orgProfile.stateCode) ? 'igst' : 'cgst_sgst';
    const pdfBuffer = await buildCreditNotePdfBuffer(docObj, orgProfile.toObject());
    const asDownload = String(req.query.download || '') === '1';
    const safeName = (row.documentNumber || row.docKey || 'credit-note').replace(/[^\w./-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${asDownload ? 'attachment' : 'inline'}; filename="${safeName}.pdf"`
    );
    res.send(pdfBuffer);
  })
);

router.get(
  '/commercial-meta',
  canRead,
  asyncHandler(async (_req, res) => {
    res.json({
      data: {
        commercialStatuses: COMMERCIAL_DOC_STATUSES,
        documentNumberStandards: DOCUMENT_NUMBER_STANDARDS,
        documentNumberFormat: 'PREFIX-YY-MM-SEQ',
      },
    });
  })
);

export default router;
