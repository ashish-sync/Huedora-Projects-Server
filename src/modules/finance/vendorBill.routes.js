import { Router } from 'express';
import multer from 'multer';
import { requirePermission, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { writeAudit } from '../../utils/audit.js';
import { nextSequence } from '../../utils/counters.js';
import { sendExcel } from '../../utils/excelExport.js';
import { escapeRegex } from '../../utils/escapeRegex.js';
import { uploadDir } from '../../config/paths.js';
import { signUploadFileUrl } from '../files/file.routes.js';
import { Contact } from '../contacts/contact.model.js';
import { FinanceInvoice } from './finance.model.js';
import { PAYMENT_MODES } from './finance.constants.js';
import {
  VENDOR_BILL_STATUSES,
  VENDOR_BILL_EDITABLE_STATUSES,
  VENDOR_BILL_PAYABLE_STATUSES,
  VENDOR_BILL_ACTIVE_STATUSES,
  normalizeVendorBillStatus,
  vendorBillStatusLabel,
  assertVendorBillTransition,
} from './vendorBill.constants.js';

const router = Router();
const canRead = requirePermission(PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_WRITE);
const canWrite = requirePermission(PERMISSIONS.FINANCE_WRITE);

const vendorBillUploadRoot = uploadDir('finance-vendor-bills');
const vendorBillUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, vendorBillUploadRoot),
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || 'bill').replace(/[^\w.\-]+/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const allowed =
      mime.startsWith('image/')
      || mime === 'application/pdf'
      || mime.includes('wordprocessingml')
      || mime === 'application/msword';
    cb(allowed ? null : new Error('Only PDF, image, or Word files are allowed'), allowed);
  },
});

function trimStr(v) {
  return v == null ? '' : String(v).trim();
}

function toAmount(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(dateText, days = 30) {
  const text = trimStr(dateText);
  const base = text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return '';
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

function signAttachmentUrl(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/uploads\/(.+)$/);
  if (!match) return raw;
  return signUploadFileUrl(match[1]);
}

function normalizeAttachment(doc = {}) {
  const url = trimStr(doc.url || doc.attachmentUrl);
  if (!url) return null;
  return {
    url: signAttachmentUrl(url),
    fileName: trimStr(doc.fileName || doc.attachmentFileName),
    mimeType: trimStr(doc.mimeType || doc.attachmentMimeType),
    storedName: trimStr(doc.storedName || doc.attachmentStoredName),
  };
}

function serializeVendorBill(row, vendorContact = null) {
  const doc = row?.toObject ? row.toObject() : { ...row };
  const status = normalizeVendorBillStatus(doc.status);
  const billNumber = trimStr(doc.billNumber || doc.invoiceNumber);
  const billDate = trimStr(doc.billDate || doc.invoiceDate);
  const paidAmount = toAmount(doc.paidAmount);
  const totalAmount = toAmount(doc.totalAmount);
  const balance = Math.max(0, Math.round((totalAmount - paidAmount) * 100) / 100);
  const contact = vendorContact || null;
  const attachments = [
    ...(Array.isArray(doc.attachments) ? doc.attachments : []).map(normalizeAttachment).filter(Boolean),
  ];
  if (!attachments.length) {
    const legacy = normalizeAttachment(doc);
    if (legacy) attachments.push(legacy);
  }
  return {
    ...doc,
    billNumber,
    invoiceNumber: billNumber,
    billDate,
    invoiceDate: billDate,
    status,
    statusLabel: vendorBillStatusLabel(status),
    balance,
    isArchived: Boolean(doc.archivedAt) || status === 'paid',
    attachmentUrl: signAttachmentUrl(doc.attachmentUrl),
    attachments,
    vendorBankName: trimStr(contact?.bankName),
    vendorAccountNumber: trimStr(contact?.accountNumber),
    vendorIfscCode: trimStr(contact?.ifscCode),
    vendorPanCardCopyUrl: signAttachmentUrl(contact?.panCardCopyUrl),
    vendorPassbookCopyUrl: signAttachmentUrl(contact?.passbookCopyUrl),
  };
}

async function loadVendorContactsByIds(ids = []) {
  const unique = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await Contact.find({ _id: { $in: unique }, isDeleted: false });
  return new Map(rows.map((row) => [String(row._id), row]));
}

async function enrichVendorBills(rows = []) {
  const byId = await loadVendorContactsByIds(rows.map((row) => row.contactId));
  return rows.map((row) => serializeVendorBill(row, byId.get(String(row.contactId || '')) || null));
}

async function assertNoDuplicateBill({ billNumber, contactId, vendorName, excludeId = null }) {
  const number = trimStr(billNumber);
  if (!number) return;
  const filter = {
    isDeleted: false,
    $or: [{ billNumber: number }, { invoiceNumber: number }],
  };
  if (contactId) filter.contactId = contactId;
  else filter.vendorName = trimStr(vendorName);

  const matches = await FinanceInvoice.find(filter);
  const clash = matches.find((row) => {
    if (excludeId && String(row._id) === String(excludeId)) return false;
    const status = normalizeVendorBillStatus(row.status);
    return status !== 'cancelled';
  });
  if (clash) {
    throw new AppError(
      `A vendor bill with number "${number}" already exists for this vendor`,
      400,
      'DUPLICATE_BILL',
    );
  }
}

function applyMoneyFields(row, body = {}) {
  if (body.amount != null) row.amount = toAmount(body.amount);
  if (body.taxAmount != null) row.taxAmount = toAmount(body.taxAmount);
  if (body.totalAmount != null && body.totalAmount !== '') {
    row.totalAmount = toAmount(body.totalAmount);
    if (body.amount == null) {
      row.amount = Math.max(0, Math.round((Number(row.totalAmount || 0) - Number(row.taxAmount || 0)) * 100) / 100);
    }
  } else if (body.amount != null || body.taxAmount != null) {
    row.totalAmount = Math.round((Number(row.amount || 0) + Number(row.taxAmount || 0)) * 100) / 100;
  }
}

function applyVendorBillFields(row, body = {}, { creating = false } = {}) {
  const billNumber = trimStr(body.billNumber ?? body.invoiceNumber);
  if (creating || body.billNumber != null || body.invoiceNumber != null) {
    if (!billNumber) throw new AppError('Bill number is required', 400, 'VALIDATION_ERROR');
    row.billNumber = billNumber;
    row.invoiceNumber = billNumber;
  }

  const vendorName = trimStr(body.vendorName);
  if (creating || body.vendorName != null) {
    if (!vendorName) throw new AppError('Vendor is required', 400, 'VALIDATION_ERROR');
    row.vendorName = vendorName;
  }

  if (body.contactId !== undefined) row.contactId = body.contactId || null;
  applyMoneyFields(row, body);

  const billDate = trimStr(body.billDate ?? body.invoiceDate);
  if (creating || body.billDate != null || body.invoiceDate != null) {
    row.billDate = billDate || todayIso();
    row.invoiceDate = row.billDate;
  }
  if (body.dueDate != null) row.dueDate = trimStr(body.dueDate);
  if (!trimStr(row.dueDate)) {
    row.dueDate = addDaysIso(row.billDate || row.invoiceDate || todayIso(), 30);
  }

  if (body.expenseCategory != null) row.expenseCategory = trimStr(body.expenseCategory);
  if (body.expenseSubCategory != null) row.expenseSubCategory = trimStr(body.expenseSubCategory);
  if (body.expenseSubCategoryId !== undefined) {
    row.expenseSubCategoryId = body.expenseSubCategoryId || null;
  }
  if (body.poDocumentId !== undefined) row.poDocumentId = body.poDocumentId || null;
  if (body.grnEntryId !== undefined) {
    row.grnEntryId = body.grnEntryId || null;
    row.linkedInOutId = body.grnEntryId || body.linkedInOutId || row.linkedInOutId || null;
  }
  if (body.linkedInOutId !== undefined) row.linkedInOutId = body.linkedInOutId || null;
  if (body.campId !== undefined) row.campId = body.campId || null;
  if (body.assetRequestId !== undefined) row.assetRequestId = body.assetRequestId || null;
  if (body.remarks != null) row.remarks = trimStr(body.remarks);
  if (body.verificationRemark != null) row.verificationRemark = trimStr(body.verificationRemark);
  if (body.rejectionReason != null) row.rejectionReason = trimStr(body.rejectionReason);
  if (body.paymentMode != null) {
    const paymentMode = trimStr(body.paymentMode);
    if (paymentMode && /^other$/i.test(paymentMode)) {
      throw new AppError('Enter a specific payment mode instead of Other', 400, 'VALIDATION_ERROR');
    }
    if (paymentMode && !PAYMENT_MODES.includes(paymentMode) && paymentMode.length < 2) {
      throw new AppError('Invalid payment mode', 400, 'VALIDATION_ERROR');
    }
    row.paymentMode = paymentMode;
  }
}

async function buildVendorBillFilter(query = {}) {
  const filter = { isDeleted: false };
  if (query.status) {
    filter.status = normalizeVendorBillStatus(query.status);
  } else if (query.archive === '1' || query.archive === 'true') {
    filter.$or = [{ archivedAt: { $ne: null } }, { status: 'paid' }];
  } else if (query.active === '1' || query.active === 'true' || query.view === 'active') {
    filter.status = { $in: [...VENDOR_BILL_ACTIVE_STATUSES] };
    filter.archivedAt = null;
  } else if (query.payable === '1' || query.payable === 'true') {
    filter.status = { $in: [...VENDOR_BILL_PAYABLE_STATUSES] };
  }
  if (query.expenseCategory) filter.expenseCategory = String(query.expenseCategory);
  if (query.contactId) filter.contactId = String(query.contactId);
  if (query.q) {
    const re = new RegExp(escapeRegex(String(query.q)), 'i');
    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { invoiceKey: re },
          { invoiceNumber: re },
          { billNumber: re },
          { vendorName: re },
          { expenseCategory: re },
          { expenseSubCategory: re },
          { transactionId: re },
          { remarks: re },
        ],
      },
    ];
  }
  return filter;
}

async function listVendorBills(req, res) {
  const { page, limit, skip, sort } = parsePagination(req.query);
  const filter = await buildVendorBillFilter(req.query);
  const rows = await FinanceInvoice.find(filter).sort(sort || '-billDate');
  const total = rows.length;
  const pageRows = rows.slice(skip, skip + limit);
  const data = await enrichVendorBills(pageRows);
  res.json(paginated(data, total, page, limit));
}

async function getVendorBill(req, res) {
  const row = await FinanceInvoice.findOne({ _id: req.params.id, isDeleted: false });
  if (!row) throw new AppError('Vendor bill not found', 404);
  const [enriched] = await enrichVendorBills([row]);
  res.json({ data: enriched });
}

async function createVendorBill(req, res) {
  const draft = {
    status: 'draft',
    amount: 0,
    taxAmount: 0,
    totalAmount: 0,
    paidAmount: 0,
  };
  applyVendorBillFields(draft, req.body, { creating: true });
  await assertNoDuplicateBill({
    billNumber: draft.billNumber,
    contactId: draft.contactId,
    vendorName: draft.vendorName,
  });

  const row = await FinanceInvoice.create({
    ...draft,
    invoiceKey: await nextSequence('financeInvoice', 'VB'),
    createdById: req.user._id,
    createdByEmail: req.user.email,
  });

  await writeAudit({
    actorId: req.user._id,
    actorEmail: req.user.email,
    action: 'FINANCE.VENDOR_BILL.CREATE',
    entityType: 'FinanceInvoice',
    entityId: row._id,
    after: row.toObject ? row.toObject() : row,
    requestId: req.requestId,
  });

  const [enriched] = await enrichVendorBills([row]);
  res.status(201).json({ data: enriched });
}

async function updateVendorBill(req, res) {
  const row = await FinanceInvoice.findOne({ _id: req.params.id, isDeleted: false });
  if (!row) throw new AppError('Vendor bill not found', 404);
  const before = row.toObject ? row.toObject() : { ...row };
  const current = normalizeVendorBillStatus(row.status);

  if (req.body.status != null && normalizeVendorBillStatus(req.body.status) !== current) {
    throw new AppError('Use the status transition endpoint to change bill status', 400, 'VALIDATION_ERROR');
  }

  if (!VENDOR_BILL_EDITABLE_STATUSES.has(current) && !VENDOR_BILL_PAYABLE_STATUSES.has(current)) {
    throw new AppError('This vendor bill can no longer be edited', 400, 'VALIDATION_ERROR');
  }

  if (VENDOR_BILL_EDITABLE_STATUSES.has(current)) {
    applyVendorBillFields(row, req.body);
    await assertNoDuplicateBill({
      billNumber: row.billNumber || row.invoiceNumber,
      contactId: row.contactId,
      vendorName: row.vendorName,
      excludeId: row._id,
    });
  } else {
    if (req.body.remarks != null) row.remarks = trimStr(req.body.remarks);
    if (req.body.paymentMode != null) row.paymentMode = trimStr(req.body.paymentMode);
  }

  await row.save();
  await writeAudit({
    actorId: req.user._id,
    actorEmail: req.user.email,
    action: 'FINANCE.VENDOR_BILL.UPDATE',
    entityType: 'FinanceInvoice',
    entityId: row._id,
    before,
    after: row.toObject ? row.toObject() : row,
    requestId: req.requestId,
  });
  const [enriched] = await enrichVendorBills([row]);
  res.json({ data: enriched });
}

async function transitionVendorBill(req, res) {
  const row = await FinanceInvoice.findOne({ _id: req.params.id, isDeleted: false });
  if (!row) throw new AppError('Vendor bill not found', 404);
  const before = row.toObject ? row.toObject() : { ...row };
  const from = normalizeVendorBillStatus(row.status);
  const to = normalizeVendorBillStatus(req.body.status);
  if (!VENDOR_BILL_STATUSES.includes(to)) {
    throw new AppError(`Invalid status: ${to}`, 400, 'VALIDATION_ERROR');
  }

  try {
    assertVendorBillTransition(from, to);
  } catch (err) {
    throw new AppError(err.message, err.status || 400, err.code || 'VALIDATION_ERROR');
  }

  if (to === 'submitted' || to === 'under_verification') {
    if (!trimStr(row.billNumber || row.invoiceNumber)) {
      throw new AppError('Bill number is required before submit', 400, 'VALIDATION_ERROR');
    }
    if (!trimStr(row.vendorName)) {
      throw new AppError('Vendor is required before submit', 400, 'VALIDATION_ERROR');
    }
    if (!(Number(row.totalAmount) > 0)) {
      throw new AppError('Total amount must be greater than zero before submit', 400, 'VALIDATION_ERROR');
    }
    if (!trimStr(row.expenseCategory) || !trimStr(row.expenseSubCategory)) {
      throw new AppError('Expense category and sub-category are required before submit', 400, 'VALIDATION_ERROR');
    }
    if (!trimStr(row.attachmentUrl)) {
      throw new AppError('Upload the vendor bill before submit', 400, 'VALIDATION_ERROR');
    }
    await assertNoDuplicateBill({
      billNumber: row.billNumber || row.invoiceNumber,
      contactId: row.contactId,
      vendorName: row.vendorName,
      excludeId: row._id,
    });
  }

  const now = new Date().toISOString();
  const actor = req.user;
  let next = to;
  if (to === 'submitted') next = 'under_verification';

  row.status = next;
  if (next === 'under_verification') {
    row.submittedAt = now;
    row.submittedById = actor._id;
    row.submittedByEmail = actor.email;
  }
  if (next === 'verified') {
    row.verifiedAt = now;
    row.verifiedById = actor._id;
    row.verifiedByEmail = actor.email;
    if (req.body.verificationRemark != null) {
      row.verificationRemark = trimStr(req.body.verificationRemark);
    }
  }
  if (next === 'draft' && from === 'under_verification') {
    row.verificationRemark = trimStr(req.body.verificationRemark || req.body.remarks || row.verificationRemark);
  }
  if (next === 'approved') {
    row.approvedAt = now;
    row.approvedById = actor._id;
    row.approvedByEmail = actor.email;
  }
  if (next === 'rejected') {
    const reason = trimStr(req.body.rejectionReason || req.body.remarks);
    if (!reason) throw new AppError('Rejection reason is required', 400, 'VALIDATION_ERROR');
    row.rejectionReason = reason;
  }
  if (next === 'cancelled') {
    row.archivedAt = null;
  }

  await row.save();
  await writeAudit({
    actorId: actor._id,
    actorEmail: actor.email,
    action: 'FINANCE.VENDOR_BILL.TRANSITION',
    entityType: 'FinanceInvoice',
    entityId: row._id,
    before,
    after: row.toObject ? row.toObject() : row,
    requestId: req.requestId,
  });
  const [enriched] = await enrichVendorBills([row]);
  res.json({ data: enriched });
}

async function payVendorBill(req, res) {
  const row = await FinanceInvoice.findOne({ _id: req.params.id, isDeleted: false });
  if (!row) throw new AppError('Vendor bill not found', 404);
  const before = row.toObject ? row.toObject() : { ...row };
  const current = normalizeVendorBillStatus(row.status);
  if (!VENDOR_BILL_PAYABLE_STATUSES.has(current)) {
    throw new AppError('Only approved vendor bills can be paid', 400, 'VALIDATION_ERROR');
  }

  const paidNow = toAmount(req.body.paidAmount ?? Math.max(0, toAmount(row.totalAmount) - toAmount(row.paidAmount)));
  const transactionId = trimStr(req.body.transactionId);
  if (!(paidNow > 0)) throw new AppError('Paid amount must be greater than zero', 400, 'VALIDATION_ERROR');
  if (!transactionId) throw new AppError('Transaction ID / UTR is required', 400, 'VALIDATION_ERROR');

  const total = toAmount(row.totalAmount);
  const alreadyPaid = toAmount(row.paidAmount);
  const paidAmount = Math.min(total, Math.round((alreadyPaid + paidNow) * 100) / 100);
  row.paidAmount = paidAmount;
  row.transactionId = transactionId;
  row.paymentRemark = trimStr(req.body.paymentRemark ?? row.paymentRemark);
  row.paymentMode = trimStr(req.body.paymentMode || row.paymentMode || 'Bank transfer');
  row.paidAt = new Date().toISOString();

  if (paidAmount + 0.001 < total) {
    row.status = 'partially_paid';
    row.archivedAt = null;
  } else {
    row.status = 'paid';
    row.archivedAt = row.paidAt;
    row.paidAmount = total;
  }

  await row.save();
  await writeAudit({
    actorId: req.user._id,
    actorEmail: req.user.email,
    action: 'FINANCE.VENDOR_BILL.PAY',
    entityType: 'FinanceInvoice',
    entityId: row._id,
    before,
    after: row.toObject ? row.toObject() : row,
    requestId: req.requestId,
  });
  const [enriched] = await enrichVendorBills([row]);
  res.json({ data: enriched });
}

async function uploadVendorBillAttachment(req, res) {
  const row = await FinanceInvoice.findOne({ _id: req.params.id, isDeleted: false });
  if (!row) throw new AppError('Vendor bill not found', 404);
  const status = normalizeVendorBillStatus(row.status);
  if (!VENDOR_BILL_EDITABLE_STATUSES.has(status) && status !== 'under_verification') {
    throw new AppError('Cannot replace attachment on this bill', 400, 'VALIDATION_ERROR');
  }
  const files = [
    ...(Array.isArray(req.files) ? req.files : []),
    ...(req.file ? [req.file] : []),
  ];
  if (!files.length) throw new AppError('Select at least one bill file to upload', 400, 'VALIDATION_ERROR');

  const existing = Array.isArray(row.attachments) ? row.attachments.filter(Boolean) : [];
  const legacy = normalizeAttachment(row);
  const attachments = existing.length ? [...existing] : legacy ? [legacy] : [];
  for (const file of files) {
    attachments.push({
      url: `/uploads/finance-vendor-bills/${file.filename}`,
      fileName: file.originalname,
      mimeType: file.mimetype,
      storedName: file.filename,
    });
  }

  row.attachments = attachments;
  const primary = attachments[0] || null;
  row.attachmentStoredName = primary?.storedName || '';
  row.attachmentFileName = primary?.fileName || '';
  row.attachmentMimeType = primary?.mimeType || '';
  row.attachmentUrl = primary?.url || '';
  await row.save();

  const [enriched] = await enrichVendorBills([row]);
  res.json({ data: enriched });
}

async function exportVendorBills(req, res) {
  const filter = await buildVendorBillFilter(req.query);
  const rows = await FinanceInvoice.find(filter).sort('-billDate');
  const data = await enrichVendorBills(rows);
  const columns = [
    { key: 'invoiceKey', label: 'Bill ID' },
    { key: 'billNumber', label: 'Bill Number' },
    { key: 'vendorName', label: 'Vendor' },
    { key: 'billDate', label: 'Bill Date' },
    { key: 'dueDate', label: 'Due Date' },
    { key: 'expenseCategory', label: 'Expense Category' },
    { key: 'expenseSubCategory', label: 'Expense Sub-Category' },
    { key: 'amount', label: 'Taxable' },
    { key: 'taxAmount', label: 'Tax' },
    { key: 'totalAmount', label: 'Total' },
    { key: 'paidAmount', label: 'Paid' },
    { key: 'balance', label: 'Balance' },
    { key: 'statusLabel', label: 'Status' },
    { key: 'transactionId', label: 'UTR' },
    { key: 'remarks', label: 'Remarks' },
  ];
  const headers = columns.map((col) => col.label);
  const excelRows = data.map((row) => columns.map((col) => row[col.key] ?? ''));
  sendExcel(res, `Vendor_Bills_${todayIso()}.xlsx`, headers, excelRows, { sheetName: 'Vendor Bills' });
}

async function softDeleteVendorBill(req, res) {
  const row = await FinanceInvoice.findOne({ _id: req.params.id, isDeleted: false });
  if (!row) throw new AppError('Vendor bill not found', 404);
  const before = row.toObject ? row.toObject() : { ...row };
  row.isDeleted = true;
  row.deletedAt = new Date().toISOString();
  await row.save();
  await writeAudit({
    actorId: req.user._id,
    actorEmail: req.user.email,
    action: 'FINANCE.VENDOR_BILL.DELETE',
    entityType: 'FinanceInvoice',
    entityId: row._id,
    before,
    after: row.toObject ? row.toObject() : row,
    requestId: req.requestId,
  });
  res.json({ data: { ok: true } });
}

router.get('/vendor-bills', canRead, asyncHandler(listVendorBills));
router.get('/vendor-bills/export', canRead, asyncHandler(exportVendorBills));
router.post('/vendor-bills', canWrite, asyncHandler(createVendorBill));
router.get('/vendor-bills/:id', canRead, asyncHandler(getVendorBill));
router.patch('/vendor-bills/:id', canWrite, asyncHandler(updateVendorBill));
router.post('/vendor-bills/:id/transition', canWrite, asyncHandler(transitionVendorBill));
router.post('/vendor-bills/:id/pay', canWrite, asyncHandler(payVendorBill));
router.post(
  '/vendor-bills/:id/attachment',
  canWrite,
  (req, res, next) => {
    vendorBillUpload.array('bills', 10)(req, res, (err) => {
      if (err) {
        next(new AppError(err.message || 'Upload failed', 400, 'UPLOAD_ERROR'));
        return;
      }
      next();
    });
  },
  asyncHandler(uploadVendorBillAttachment),
);
router.delete('/vendor-bills/:id', requireAdmin, asyncHandler(softDeleteVendorBill));

// Back-compat aliases for legacy /finance/invoices clients
router.get('/invoices', canRead, asyncHandler(listVendorBills));
router.get('/invoices/export', canRead, asyncHandler(exportVendorBills));
router.post('/invoices', canWrite, asyncHandler(createVendorBill));
router.get('/invoices/:id', canRead, asyncHandler(getVendorBill));
router.patch('/invoices/:id', canWrite, asyncHandler(updateVendorBill));
router.post('/invoices/:id/transition', canWrite, asyncHandler(transitionVendorBill));
router.post('/invoices/:id/pay', canWrite, asyncHandler(payVendorBill));
router.post(
  '/invoices/:id/attachment',
  canWrite,
  (req, res, next) => {
    vendorBillUpload.array('bills', 10)(req, res, (err) => {
      if (err) {
        next(new AppError(err.message || 'Upload failed', 400, 'UPLOAD_ERROR'));
        return;
      }
      next();
    });
  },
  asyncHandler(uploadVendorBillAttachment),
);
router.delete('/invoices/:id', requireAdmin, asyncHandler(softDeleteVendorBill));

export default router;
