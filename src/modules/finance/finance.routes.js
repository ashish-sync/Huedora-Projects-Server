import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, parsePagination, paginated, AppError } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { writeAudit } from '../../utils/audit.js';
import { nextSequence } from '../../utils/counters.js';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  INVOICE_STATUSES,
  PAYMENT_MODES,
} from './finance.constants.js';
import { DOCUMENT_NUMBER_STANDARDS } from './documentNumbering.js';
import { FinanceExpense, FinanceInvoice, FinanceCommercialDocument } from './finance.model.js';
import financeCommercialRoutes from './financeCommercial.routes.js';

const router = Router();
router.use(authenticate);

const canRead = requirePermission(PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_WRITE);
const canWrite = requirePermission(PERMISSIONS.FINANCE_WRITE);

router.use(financeCommercialRoutes);

function trimStr(v) {
  return v == null ? '' : String(v).trim();
}

function toAmount(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

router.get(
  '/meta',
  canRead,
  asyncHandler(async (_req, res) => {
    res.json({
      data: {
        expenseCategories: EXPENSE_CATEGORIES,
        expenseStatuses: EXPENSE_STATUSES,
        invoiceStatuses: INVOICE_STATUSES,
        paymentModes: PAYMENT_MODES,
        documentNumberStandards: DOCUMENT_NUMBER_STANDARDS,
        documentNumberFormat: 'PREFIX-YY-MM-SEQ',
      },
    });
  })
);

router.get(
  '/summary',
  canRead,
  asyncHandler(async (_req, res) => {
    const [expenses, invoices, proformas, purchaseOrders] = await Promise.all([
      FinanceExpense.find({ isDeleted: false }),
      FinanceInvoice.find({ isDeleted: false }),
      FinanceCommercialDocument.find({ isDeleted: false, documentType: 'proforma' }),
      FinanceCommercialDocument.find({ isDeleted: false, documentType: 'purchase_order' }),
    ]);

    const expenseTotal = expenses.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const expenseOpen = expenses.filter((r) =>
      ['Draft', 'Submitted', 'Approved'].includes(r.status)
    ).length;
    const invoiceTotal = invoices.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
    const invoiceOpen = invoices.filter((r) => r.status === 'Open' || r.status === 'Partially paid')
      .length;
    const proformaDraft = proformas.filter((r) => r.status === 'Draft' || r.status === 'Uploaded').length;
    const proformaIssued = proformas.filter((r) => r.status === 'Issued').length;
    const proformaTotal = proformas.reduce((s, r) => s + (Number(r.grandTotal) || 0), 0);
    const poDraft = purchaseOrders.filter((r) => r.status === 'Draft' || r.status === 'Uploaded').length;
    const poIssued = purchaseOrders.filter((r) => r.status === 'Issued').length;
    const poTotal = purchaseOrders.reduce((s, r) => s + (Number(r.grandTotal) || 0), 0);

    res.json({
      data: {
        expenseCount: expenses.length,
        expenseTotal,
        expenseOpen,
        invoiceCount: invoices.length,
        invoiceTotal,
        invoiceOpen,
        proformaCount: proformas.length,
        proformaTotal,
        proformaDraft,
        proformaIssued,
        purchaseOrderCount: purchaseOrders.length,
        purchaseOrderTotal: poTotal,
        purchaseOrderDraft: poDraft,
        purchaseOrderIssued: poIssued,
      },
    });
  })
);

router.get(
  '/expenses',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.category) filter.category = String(req.query.category);
    if (req.query.q) {
      const re = new RegExp(String(req.query.q), 'i');
      filter.$or = [{ expenseKey: re }, { title: re }, { payeeName: re }, { remarks: re }];
    }
    const [data, total] = await Promise.all([
      FinanceExpense.find(filter).sort(sort || '-expenseDate').skip(skip).limit(limit),
      FinanceExpense.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.post(
  '/expenses',
  canWrite,
  asyncHandler(async (req, res) => {
    const title = trimStr(req.body.title);
    if (!title) throw new AppError('Title is required', 400, 'VALIDATION_ERROR');
    const category = trimStr(req.body.category) || '';
    if (!category || /^other$/i.test(category)) {
      throw new AppError('Category is required (use Other to enter a new value)', 400, 'VALIDATION_ERROR');
    }
    const amount = toAmount(req.body.amount);
    if (!(amount > 0)) throw new AppError('Amount must be greater than zero', 400, 'VALIDATION_ERROR');
    const status = trimStr(req.body.status) || 'Draft';
    if (!EXPENSE_STATUSES.includes(status)) {
      throw new AppError(
        `Status must be one of: ${EXPENSE_STATUSES.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      );
    }
    const paymentMode = trimStr(req.body.paymentMode);
    if (paymentMode && /^other$/i.test(paymentMode)) {
      throw new AppError('Enter a specific payment mode instead of Other', 400, 'VALIDATION_ERROR');
    }

    const row = await FinanceExpense.create({
      expenseKey: await nextSequence('financeExpense', 'EXP'),
      title,
      category,
      amount,
      expenseDate: trimStr(req.body.expenseDate) || todayIso(),
      status,
      paymentMode,
      payeeName: trimStr(req.body.payeeName),
      contactId: req.body.contactId || null,
      remarks: trimStr(req.body.remarks),
      createdById: req.user._id,
      createdByEmail: req.user.email,
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'FINANCE.EXPENSE.CREATE',
      entityType: 'FinanceExpense',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.status(201).json({ data: row });
  })
);

router.patch(
  '/expenses/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await FinanceExpense.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Expense not found', 404);

    if (req.body.title != null) {
      const title = trimStr(req.body.title);
      if (!title) throw new AppError('Title is required', 400, 'VALIDATION_ERROR');
      row.title = title;
    }
    if (req.body.category != null) {
      const category = trimStr(req.body.category);
      if (!category || /^other$/i.test(category)) {
        throw new AppError('Category is required (use Other to enter a new value)', 400, 'VALIDATION_ERROR');
      }
      row.category = category;
    }
    if (req.body.amount != null) {
      const amount = toAmount(req.body.amount);
      if (!(amount > 0)) throw new AppError('Amount must be greater than zero', 400, 'VALIDATION_ERROR');
      row.amount = amount;
    }
    if (req.body.expenseDate != null) row.expenseDate = trimStr(req.body.expenseDate);
    if (req.body.status != null) {
      const status = trimStr(req.body.status);
      if (!EXPENSE_STATUSES.includes(status)) {
        throw new AppError(
          `Status must be one of: ${EXPENSE_STATUSES.join(', ')}`,
          400,
          'VALIDATION_ERROR'
        );
      }
      row.status = status;
      if (status === 'Approved' || status === 'Paid') {
        row.approvedById = req.user._id;
        row.approvedAt = new Date().toISOString();
      }
    }
    if (req.body.paymentMode != null) {
      const paymentMode = trimStr(req.body.paymentMode);
      if (paymentMode && /^other$/i.test(paymentMode)) {
        throw new AppError('Enter a specific payment mode instead of Other', 400, 'VALIDATION_ERROR');
      }
      row.paymentMode = paymentMode;
    }
    if (req.body.payeeName != null) row.payeeName = trimStr(req.body.payeeName);
    if (req.body.contactId !== undefined) row.contactId = req.body.contactId || null;
    if (req.body.remarks != null) row.remarks = trimStr(req.body.remarks);

    await row.save();
    res.json({ data: row });
  })
);

router.delete(
  '/expenses/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await FinanceExpense.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Expense not found', 404);
    row.isDeleted = true;
    row.deletedAt = new Date().toISOString();
    await row.save();
    res.json({ data: { ok: true } });
  })
);

router.get(
  '/invoices',
  canRead,
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.q) {
      const re = new RegExp(String(req.query.q), 'i');
      filter.$or = [
        { invoiceKey: re },
        { invoiceNumber: re },
        { vendorName: re },
        { remarks: re },
      ];
    }
    const [data, total] = await Promise.all([
      FinanceInvoice.find(filter).sort(sort || '-invoiceDate').skip(skip).limit(limit),
      FinanceInvoice.countDocuments(filter),
    ]);
    res.json(paginated(data, total, page, limit));
  })
);

router.post(
  '/invoices',
  canWrite,
  asyncHandler(async (req, res) => {
    const invoiceNumber = trimStr(req.body.invoiceNumber);
    if (!invoiceNumber) throw new AppError('Invoice number is required', 400, 'VALIDATION_ERROR');
    const vendorName = trimStr(req.body.vendorName);
    if (!vendorName) throw new AppError('Vendor name is required', 400, 'VALIDATION_ERROR');
    const amount = toAmount(req.body.amount);
    const taxAmount = toAmount(req.body.taxAmount);
    const totalAmount =
      req.body.totalAmount != null && req.body.totalAmount !== ''
        ? toAmount(req.body.totalAmount)
        : Math.round((amount + taxAmount) * 100) / 100;
    if (!(totalAmount > 0)) {
      throw new AppError('Total amount must be greater than zero', 400, 'VALIDATION_ERROR');
    }
    const status = trimStr(req.body.status) || 'Open';
    if (!INVOICE_STATUSES.includes(status)) {
      throw new AppError(
        `Status must be one of: ${INVOICE_STATUSES.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      );
    }
    const paymentMode = trimStr(req.body.paymentMode);
    if (paymentMode && /^other$/i.test(paymentMode)) {
      throw new AppError('Enter a specific payment mode instead of Other', 400, 'VALIDATION_ERROR');
    }

    const row = await FinanceInvoice.create({
      invoiceKey: await nextSequence('financeInvoice', 'INV'),
      invoiceNumber,
      vendorName,
      contactId: req.body.contactId || null,
      amount,
      taxAmount,
      totalAmount,
      invoiceDate: trimStr(req.body.invoiceDate) || todayIso(),
      dueDate: trimStr(req.body.dueDate),
      status,
      paymentMode,
      linkedInOutId: req.body.linkedInOutId || null,
      remarks: trimStr(req.body.remarks),
      createdById: req.user._id,
      createdByEmail: req.user.email,
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'FINANCE.INVOICE.CREATE',
      entityType: 'FinanceInvoice',
      entityId: row._id,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.status(201).json({ data: row });
  })
);

router.patch(
  '/invoices/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await FinanceInvoice.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Invoice not found', 404);

    if (req.body.invoiceNumber != null) {
      const invoiceNumber = trimStr(req.body.invoiceNumber);
      if (!invoiceNumber) throw new AppError('Invoice number is required', 400, 'VALIDATION_ERROR');
      row.invoiceNumber = invoiceNumber;
    }
    if (req.body.vendorName != null) {
      const vendorName = trimStr(req.body.vendorName);
      if (!vendorName) throw new AppError('Vendor name is required', 400, 'VALIDATION_ERROR');
      row.vendorName = vendorName;
    }
    if (req.body.amount != null) row.amount = toAmount(req.body.amount);
    if (req.body.taxAmount != null) row.taxAmount = toAmount(req.body.taxAmount);
    if (req.body.totalAmount != null) {
      const totalAmount = toAmount(req.body.totalAmount);
      if (!(totalAmount > 0)) {
        throw new AppError('Total amount must be greater than zero', 400, 'VALIDATION_ERROR');
      }
      row.totalAmount = totalAmount;
    } else if (req.body.amount != null || req.body.taxAmount != null) {
      row.totalAmount = Math.round((Number(row.amount) + Number(row.taxAmount)) * 100) / 100;
    }
    if (req.body.invoiceDate != null) row.invoiceDate = trimStr(req.body.invoiceDate);
    if (req.body.dueDate != null) row.dueDate = trimStr(req.body.dueDate);
    if (req.body.status != null) {
      const status = trimStr(req.body.status);
      if (!INVOICE_STATUSES.includes(status)) {
        throw new AppError(
          `Status must be one of: ${INVOICE_STATUSES.join(', ')}`,
          400,
          'VALIDATION_ERROR'
        );
      }
      row.status = status;
    }
    if (req.body.paymentMode != null) {
      const paymentMode = trimStr(req.body.paymentMode);
      if (paymentMode && /^other$/i.test(paymentMode)) {
        throw new AppError('Enter a specific payment mode instead of Other', 400, 'VALIDATION_ERROR');
      }
      row.paymentMode = paymentMode;
    }
    if (req.body.contactId !== undefined) row.contactId = req.body.contactId || null;
    if (req.body.linkedInOutId !== undefined) row.linkedInOutId = req.body.linkedInOutId || null;
    if (req.body.remarks != null) row.remarks = trimStr(req.body.remarks);

    await row.save();
    res.json({ data: row });
  })
);

router.delete(
  '/invoices/:id',
  canWrite,
  asyncHandler(async (req, res) => {
    const row = await FinanceInvoice.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Invoice not found', 404);
    row.isDeleted = true;
    row.deletedAt = new Date().toISOString();
    await row.save();
    res.json({ data: { ok: true } });
  })
);

export default router;
