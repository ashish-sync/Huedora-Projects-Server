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
  assertEditableStatus,
  assertIssuable,
  fiscalYearLabel,
  getOrCreateOrgProfile,
  mergeOrgProfile,
  nextProformaNumber,
  nextPurchaseOrderNumber,
  normalizeProformaPayload,
  normalizePurchaseOrderPayload,
  toAmount,
  todayIso,
  trimStr,
  validateProformaPayload,
  validatePurchaseOrderPayload,
  usesIgst,
} from './financeCommercial.service.js';
import { buildProformaPdfBuffer } from './proformaPdf.js';
import { buildPurchaseOrderPdfBuffer } from './purchaseOrderPdf.js';
import { buildClientInvoicePdfBuffer } from './clientInvoicePdf.js';
import { buildCreditNotePdfBuffer } from './creditNotePdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.resolve(__dirname, '../../../uploads/finance');
fs.mkdirSync(uploadRoot, { recursive: true });

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
    const ok =
      file.mimetype === 'application/pdf' ||
      file.mimetype.includes('word') ||
      file.mimetype.includes('sheet') ||
      /\.(pdf|docx?|xlsx?)$/i.test(file.originalname || '');
    cb(ok ? null : new Error('Only PDF, Word, or Excel files are allowed'), ok);
  },
});

const router = Router();
router.use(authenticate);

const canRead = requirePermission(PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_WRITE);
const canWrite = requirePermission(PERMISSIONS.FINANCE_WRITE);

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
      const re = new RegExp(String(req.query.q), 'i');
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
    validateProformaPayload(payload);

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
    validateProformaPayload(payload);

    Object.assign(row, payload);
    if (req.body.documentNumber != null) {
      const manual = trimStr(req.body.documentNumber);
      row.documentNumber = manual ? validateManualDocumentNumber(manual, 'proforma') : '';
    }
    await row.save();
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
    const re = new RegExp(String(req.query.q), 'i');
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
    validatePurchaseOrderPayload(payload);

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
    validatePurchaseOrderPayload(payload);

    Object.assign(row, payload);
    if (req.body.documentNumber != null) {
      const manual = trimStr(req.body.documentNumber);
      row.documentNumber = manual ? validateManualDocumentNumber(manual, 'purchase_order') : '';
    }
    await row.save();
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
