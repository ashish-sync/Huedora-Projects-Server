import { Router } from 'express';
import { authenticate, requirePermission, requireAdmin } from '../../middleware/auth.js';
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
import vendorBillRoutes from './vendorBill.routes.js';
import { CampOpsCamp } from '../campOps/campOps.model.js';
import { VENDOR_BILL_ACTIVE_STATUSES, normalizeVendorBillStatus } from './vendorBill.constants.js';
import {
  computeLifecycleDerived,
  normalizeFinancePaymentStatus,
  FINANCE_PAYMENT_STATUSES,
} from '../campOps/campOps.lifecycle.js';
import {
  assertCampSubmittedToFinance,
  buildCampFinanceExportRow,
  campFinanceBulkExportFilename,
  campFinanceExportFilename,
  campFinanceExportHeaders,
  campFinanceExportRows,
} from '../campOps/campFinanceExport.js';
import { sendExcel } from '../../utils/excelExport.js';
import { escapeRegex } from '../../utils/escapeRegex.js';
import {
  CAMP_FINANCE_EXPENSE_CATEGORY,
  CAMP_FINANCE_EXPENSE_SUB_CATEGORY,
} from '../campOps/campFinanceExpense.js';
import { enrichCampPayoutsWithPayee } from '../contacts/campPayoutPayee.js';

const router = Router();
router.use(authenticate);

const canRead = requirePermission(PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_WRITE);
const canWrite = requirePermission(PERMISSIONS.FINANCE_WRITE);

router.use(financeCommercialRoutes);
router.use(vendorBillRoutes);

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
        documentNumberFormat: 'PREFIX/FY/MM/SEQ',
      },
    });
  })
);

router.get(
  '/summary',
  canRead,
  asyncHandler(async (_req, res) => {
    const [expenses, invoices, proformas, purchaseOrders, clientInvoices, creditNotes, deliveryChallans, billsOfSupply] =
      await Promise.all([
        FinanceExpense.find({ isDeleted: false }),
        FinanceInvoice.find({ isDeleted: false }),
        FinanceCommercialDocument.find({ isDeleted: false, documentType: 'proforma' }),
        FinanceCommercialDocument.find({ isDeleted: false, documentType: 'purchase_order' }),
        FinanceCommercialDocument.find({ isDeleted: false, documentType: 'client_invoice' }),
        FinanceCommercialDocument.find({ isDeleted: false, documentType: 'credit_note' }),
        FinanceCommercialDocument.find({ isDeleted: false, documentType: 'delivery_challan' }),
        FinanceCommercialDocument.find({ isDeleted: false, documentType: 'bill_of_supply' }),
      ]);

    const expenseTotal = expenses.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const expenseOpen = expenses.filter((r) =>
      ['Draft', 'Submitted', 'Approved'].includes(r.status)
    ).length;
    const invoiceTotal = invoices.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
    const invoiceOpen = invoices.filter((r) =>
      VENDOR_BILL_ACTIVE_STATUSES.has(normalizeVendorBillStatus(r.status))
    ).length;
    const proformaDraft = proformas.filter((r) => r.status === 'Draft' || r.status === 'Uploaded').length;
    const proformaIssued = proformas.filter((r) => r.status === 'Issued').length;
    const proformaTotal = proformas.reduce((s, r) => s + (Number(r.grandTotal) || 0), 0);
    const poDraft = purchaseOrders.filter((r) => r.status === 'Draft' || r.status === 'Uploaded').length;
    const poIssued = purchaseOrders.filter((r) => r.status === 'Issued').length;
    const poTotal = purchaseOrders.reduce((s, r) => s + (Number(r.grandTotal) || 0), 0);
    const clientInvoiceDraft = clientInvoices.filter((r) =>
      ['Draft', 'Uploaded', 'Submitted', 'Approved'].includes(r.status)
    ).length;
    const clientInvoiceIssued = clientInvoices.filter((r) => r.status === 'Issued').length;
    const clientInvoiceTotal = clientInvoices.reduce((s, r) => s + (Number(r.grandTotal) || 0), 0);
    const creditNoteCount = creditNotes.length;
    const creditNoteTotal = creditNotes.reduce((s, r) => s + (Number(r.grandTotal) || 0), 0);
    const deliveryChallanCount = deliveryChallans.length;
    const deliveryChallanTotal = deliveryChallans.reduce((s, r) => s + (Number(r.grandTotal) || 0), 0);
    const billOfSupplyCount = billsOfSupply.length;
    const billOfSupplyTotal = billsOfSupply.reduce((s, r) => s + (Number(r.grandTotal) || 0), 0);
    const commercialSubmitted = [
      ...proformas,
      ...purchaseOrders,
      ...clientInvoices,
      ...creditNotes,
      ...deliveryChallans,
      ...billsOfSupply,
    ].filter((r) => r.status === 'Submitted').length;

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
        clientInvoiceCount: clientInvoices.length,
        clientInvoiceTotal,
        clientInvoiceDraft,
        clientInvoiceIssued,
        creditNoteCount,
        creditNoteTotal,
        deliveryChallanCount,
        deliveryChallanTotal,
        billOfSupplyCount,
        billOfSupplyTotal,
        commercialSubmitted,
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
      const re = new RegExp(escapeRegex(String(req.query.q)), 'i');
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
    const before = row.toObject ? row.toObject() : { ...row };

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

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'FINANCE.EXPENSE.UPDATE',
      entityType: 'FinanceExpense',
      entityId: row._id,
      before,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.json({ data: row });
  })
);

router.delete(
  '/expenses/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await FinanceExpense.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('Expense not found', 404);
    const before = row.toObject ? row.toObject() : { ...row };
    row.isDeleted = true;
    row.deletedAt = new Date().toISOString();
    await row.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'FINANCE.EXPENSE.DELETE',
      entityType: 'FinanceExpense',
      entityId: row._id,
      before,
      after: row.toObject ? row.toObject() : row,
      requestId: req.requestId,
    });

    res.json({ data: { ok: true } });
  })
);

function campMonthKey(campDate) {
  const raw = String(campDate || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(raw) ? raw : '';
}

function campPayoutSummary(camp) {
  const row = camp?.toObject ? camp.toObject() : { ...camp };
  const derived = computeLifecycleDerived(row);
  const month = campMonthKey(row.campDate);
  return {
    _id: row._id,
    campId: row.campId,
    clientId: row.clientId,
    clientName: row.clientName,
    campaignType: row.campaignType || '',
    campaignName: row.campaignName,
    campDate: row.campDate,
    campMonth: month,
    hcwCategory: row.hcwCategory || '',
    hcwName: row.hcwName,
    hcwContact: row.hcwContact,
    hcwContactId: row.hcwContactId || '',
    totalPayout: derived.totalPayout,
    balance: derived.balance,
    paymentSubmitStatus: row.paymentSubmitStatus,
    financePaymentStatus: row.financePaymentStatus,
    paidAmount: row.paidAmount,
    transactionId: row.transactionId,
    paymentRemark: row.paymentRemark,
    expenseCategory: row.expenseCategory || CAMP_FINANCE_EXPENSE_CATEGORY,
    expenseSubCategory: row.expenseSubCategory || CAMP_FINANCE_EXPENSE_SUB_CATEGORY,
    expenseSubCategoryId: row.expenseSubCategoryId || null,
    submittedToFinanceAt: row.submittedToFinanceAt,
    submittedToFinanceByEmail: row.submittedToFinanceByEmail,
    financeProcessedAt: row.financeProcessedAt,
    financeProcessedByEmail: row.financeProcessedByEmail,
    lifecycleStage: row.lifecycleStage,
    status: row.status,
    payeeContactId: '',
    payeeName: row.hcwName || '',
    payeeIsServiceProvider: false,
    assignedHcwName: row.hcwName || '',
    bankName: '',
    accountNumber: '',
    ifscCode: '',
    panCardCopyUrl: '',
    passbookCopyUrl: '',
  };
}

async function campPayoutSummaryWithPayeeBank(camp) {
  const [enriched] = await enrichCampPayoutsWithPayee([campPayoutSummary(camp)]);
  return enriched;
}

function applyCampPayoutFields(camp, body = {}, actor = {}) {
  const status = normalizeFinancePaymentStatus(body.financePaymentStatus || camp.financePaymentStatus);
  if (!status || !FINANCE_PAYMENT_STATUSES.includes(status)) {
    throw new AppError(
      'financePaymentStatus must be paid, not_paid, or under_review',
      400,
      'VALIDATION_ERROR'
    );
  }

  camp.financePaymentStatus = status;

  if (status === 'paid') {
    const paidAmount = toAmount(body.paidAmount ?? camp.paidAmount);
    const transactionId = trimStr(body.transactionId ?? camp.transactionId);
    if (!paidAmount) {
      throw new AppError('Paid Amount is required when status is Paid', 400, 'VALIDATION_ERROR');
    }
    if (!transactionId) {
      throw new AppError('Transaction ID / UTR is required when status is Paid', 400, 'VALIDATION_ERROR');
    }
    camp.paidAmount = paidAmount;
    camp.transactionId = transactionId;
    camp.paymentRemark = trimStr(body.paymentRemark ?? camp.paymentRemark);
  } else {
    if (body.paidAmount !== undefined) camp.paidAmount = toAmount(body.paidAmount);
    if (body.transactionId !== undefined) camp.transactionId = trimStr(body.transactionId);
    if (body.paymentRemark !== undefined) camp.paymentRemark = trimStr(body.paymentRemark);
  }

  const derived = computeLifecycleDerived(camp);
  camp.balance = derived.balance;
  camp.totalPayout = derived.totalPayout;
  camp.financeProcessedAt = new Date().toISOString();
  camp.financeProcessedById = actor?._id || null;
  camp.financeProcessedByEmail = actor?.email || '';
  return camp;
}

function buildCampPayoutFilter(query = {}) {
  const filter = { isDeleted: false, submittedToFinanceAt: { $ne: null } };
  if (query.status) {
    filter.financePaymentStatus = normalizeFinancePaymentStatus(query.status);
  }
  if (query.q) {
    const re = new RegExp(escapeRegex(String(query.q)), 'i');
    filter.$or = [
      { campId: re },
      { clientName: re },
      { hcwName: re },
      { hcwCategory: re },
      { campaignName: re },
      { campaignType: re },
      { transactionId: re },
    ];
  }
  return filter;
}

const listCampPayouts = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
  const skip = (page - 1) * limit;
  const filter = buildCampPayoutFilter(req.query);
  const rows = await CampOpsCamp.find(filter).sort('-submittedToFinanceAt');
  const total = rows.length;
  const data = await enrichCampPayoutsWithPayee(
    rows.slice(skip, skip + limit).map(campPayoutSummary),
  );
  res.json(paginated(data, total, page, limit));
});

const exportCampPayouts = asyncHandler(async (req, res) => {
  const filter = buildCampPayoutFilter(req.query);
  const camps = await CampOpsCamp.find(filter).sort('-submittedToFinanceAt');
  sendExcel(
    res,
    campFinanceBulkExportFilename(),
    campFinanceExportHeaders(),
    campFinanceExportRows(camps),
    { sheetName: 'Camp Payouts' },
  );
});

const bulkUpdateCampPayouts = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  if (!ids.length) {
    throw new AppError('Select at least one camp payout', 400, 'VALIDATION_ERROR');
  }

  const status = normalizeFinancePaymentStatus(req.body?.financePaymentStatus);
  if (!status || !FINANCE_PAYMENT_STATUSES.includes(status)) {
    throw new AppError(
      'financePaymentStatus must be paid, not_paid, or under_review',
      400,
      'VALIDATION_ERROR'
    );
  }

  const transactionId = trimStr(req.body?.transactionId);
  const paymentRemark = trimStr(req.body?.paymentRemark);
  const sharedPaidAmount = req.body?.paidAmount !== undefined && req.body?.paidAmount !== ''
    ? toAmount(req.body.paidAmount)
    : null;

  if (status === 'paid' && !transactionId) {
    throw new AppError('Transaction ID / UTR is required when status is Paid', 400, 'VALIDATION_ERROR');
  }

  const camps = await CampOpsCamp.find({
    _id: { $in: ids },
    isDeleted: false,
    submittedToFinanceAt: { $ne: null },
  });
  if (!camps.length) {
    throw new AppError('No matching camp payouts found', 404);
  }

  const a = req.user;
  const updated = [];
  for (const camp of camps) {
    const derived = computeLifecycleDerived(camp);
    const paidAmount = status === 'paid'
      ? (sharedPaidAmount != null && camps.length === 1
        ? sharedPaidAmount
        : derived.totalPayout || toAmount(camp.paidAmount) || 0)
      : (sharedPaidAmount != null ? sharedPaidAmount : camp.paidAmount);

    if (status === 'paid' && !paidAmount) {
      throw new AppError(
        `Paid Amount is required for ${camp.campId || camp._id}`,
        400,
        'VALIDATION_ERROR',
      );
    }

    applyCampPayoutFields(camp, {
      financePaymentStatus: status,
      paidAmount,
      transactionId: status === 'paid' ? transactionId : (req.body?.transactionId ?? camp.transactionId),
      paymentRemark: paymentRemark || camp.paymentRemark,
    }, a);
    await camp.save();
    updated.push(await campPayoutSummaryWithPayeeBank(camp));
  }

  await writeAudit({
    actorId: a?._id || null,
    actorEmail: a?.email || null,
    action: 'FINANCE.CAMP_PAYOUT_BULK_UPDATE',
    entityType: 'camp_ops_camp',
    entityId: null,
    after: {
      count: updated.length,
      financePaymentStatus: status,
      transactionId: status === 'paid' ? transactionId : undefined,
      ids: updated.map((row) => row._id),
    },
    requestId: req.requestId,
  });

  res.json({
    data: updated,
    message: `Updated ${updated.length} camp payout${updated.length === 1 ? '' : 's'}`,
  });
});

const exportCampPayoutById = asyncHandler(async (req, res) => {
  const camp = await CampOpsCamp.findOne({
    _id: req.params.campId,
    isDeleted: false,
    submittedToFinanceAt: { $ne: null },
  });
  if (!camp) throw new AppError('Camp payout not found', 404);
  assertCampSubmittedToFinance(camp);
  sendExcel(
    res,
    campFinanceExportFilename(camp),
    campFinanceExportHeaders(),
    [buildCampFinanceExportRow(camp)],
    { sheetName: 'Camp Payout' },
  );
});

const updateCampPayoutById = asyncHandler(async (req, res) => {
  const camp = await CampOpsCamp.findOne({
    _id: req.params.campId,
    isDeleted: false,
    submittedToFinanceAt: { $ne: null },
  });
  if (!camp) throw new AppError('Camp payout not found', 404);

  const a = req.user;
  applyCampPayoutFields(camp, req.body, a);
  await camp.save();

  await writeAudit({
    actorId: a?._id || null,
    actorEmail: a?.email || null,
    action: 'FINANCE.CAMP_PAYOUT_UPDATE',
    entityType: 'camp_ops_camp',
    entityId: camp._id,
    after: {
      financePaymentStatus: camp.financePaymentStatus,
      paidAmount: camp.paidAmount,
      transactionId: camp.transactionId,
      balance: camp.balance,
    },
    requestId: req.requestId,
  });

  res.json({ data: await campPayoutSummaryWithPayeeBank(camp) });
});

// Canonical paths + /payouts aliases (SPA historically called /finance/payouts).
for (const base of ['/camp-payouts', '/payouts']) {
  router.get(base, canRead, listCampPayouts);
  router.get(`${base}/export`, canRead, exportCampPayouts);
  router.post(`${base}/bulk`, canWrite, bulkUpdateCampPayouts);
  router.get(`${base}/:campId/export`, canRead, exportCampPayoutById);
  router.patch(`${base}/:campId`, canWrite, updateCampPayoutById);
}

export default router;
