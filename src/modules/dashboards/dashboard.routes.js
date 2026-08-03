import { Router } from 'express';
import { authenticate, requirePermission, hasPermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { Asset } from '../assets/asset.model.js';
import { Agreement } from '../agreements/agreement.model.js';
import { RepairTicket } from '../repairs/repair.model.js';
import { Movement } from '../movements/movement.model.js';
import { Contact } from '../contacts/contact.model.js';
import { DocumentTemplate } from '../templates/template.model.js';
import { SignatureMaster } from '../signatures/signature.model.js';
import { Role } from '../users/role.model.js';
import { User } from '../users/user.model.js';
import { AssetRequest } from '../assetRequests/assetRequest.model.js';
import { CampOpsCamp } from '../campOps/campOps.model.js';
import {
  FinanceExpense,
  FinanceInvoice,
  FinanceCommercialDocument,
} from '../finance/finance.model.js';
import { sendExcel, sendMultiSheetExcel } from '../../utils/excelExport.js';
import {
  ASSET_STATUS_OPTIONS,
  isVerificationOneEligibleAsset,
} from '../devices/device.constants.js';
import {
  computeDeviceCondition,
  periodKeyFromDate,
} from '../verifications/verification.condition.js';
import { VerificationCampaign, VerificationRecord } from '../verifications/verification.model.js';
import { listReviewModulesForUser, runModuleReview } from './moduleReview.js';

function countMap(rows) {
  return Object.fromEntries((rows || []).map((x) => [x._id || 'Unknown', x.count]));
}

function sumAmount(rows, key = 'amount') {
  return (rows || []).reduce((s, r) => s + (Number(r[key]) || 0), 0);
}

function healthFromSignals({ alerts, pendingTotal }) {
  let score = 100;
  for (const a of alerts) {
    if (a.severity === 'critical') score -= 18;
    else if (a.severity === 'high') score -= 12;
    else if (a.severity === 'medium') score -= 6;
    else score -= 3;
  }
  if (pendingTotal > 25) score -= 8;
  else if (pendingTotal > 10) score -= 4;
  score = Math.max(0, Math.min(100, score));
  let label = 'Healthy';
  let tone = 'ok';
  if (score < 50) {
    label = 'At risk';
    tone = 'critical';
  } else if (score < 75) {
    label = 'Needs attention';
    tone = 'warn';
  }
  return { score, label, tone };
}

const router = Router();
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.DASHBOARDS_READ));

/** Catalog of modules the current user can review */
router.get(
  '/modules',
  asyncHandler(async (req, res) => {
    res.json({ data: listReviewModulesForUser(req) });
  })
);

/**
 * Module review: select module + date range → summary KPIs + rows.
 * Query: module (required), from, to (YYYY-MM-DD)
 */
router.get(
  '/module-review',
  asyncHandler(async (req, res) => {
    const data = await runModuleReview(req);
    res.json({ data });
  })
);

router.get(
  '/module-review/export',
  asyncHandler(async (req, res) => {
    const data = await runModuleReview(req);
    const headers = (data.columns || []).map((c) => c.label);
    const keys = (data.columns || []).map((c) => c.key);
    const rows = (data.rows || []).map((row) => keys.map((k) => row[k] ?? ''));
    const safeName = String(data.moduleLabel || data.module || 'Module')
      .replace(/[^\w.\- ]+/g, '_')
      .replace(/\s+/g, '_');
    sendExcel(res, `TYLO_One_${safeName}_Review.xlsx`, headers, rows, {
      sheetName: data.moduleLabel || 'Review',
    });
  })
);

async function ensureCampaign(periodKey, userId) {
  let campaign = await VerificationCampaign.findOne({ periodKey, isDeleted: false });
  if (!campaign) {
    campaign = await VerificationCampaign.create({
      periodKey,
      label: periodKey,
      status: 'OPEN',
      requireRound2: true,
      createdBy: userId,
    });
  }
  return campaign;
}

async function ensureRecord(campaign, asset, userId) {
  let record = await VerificationRecord.findOne({
    campaignId: campaign._id,
    assetId: asset._id,
    isDeleted: false,
  });
  if (!record) {
    record = await VerificationRecord.create({
      campaignId: campaign._id,
      periodKey: campaign.periodKey,
      assetId: asset._id,
      serialNumber: asset.serialNumber || null,
      brandModelTest: asset.deviceNameSnapshot || null,
      custodianName: null,
      status: 'IN_PROGRESS',
      round1: {},
      round2: {},
      createdBy: userId,
      updatedBy: userId,
    });
  }
  return record;
}

/**
 * Executive one-page overview: KPIs, pending actions, risks, financials, module health.
 */
router.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const [
      assetCount,
      contactCount,
      assetsByStatusRows,
      agreementsByStatusRows,
      agreementsActive,
      agreementsExpiring,
      agreementsExpired,
      openRepairs,
      repairOpenItems,
      pendingMovements,
      movementsByStatusRows,
      verificationExceptions,
      verificationByStatusRows,
      requestsByStatusRows,
      requestsByTypeRows,
      pendingRequests,
      campsByStatusRows,
      campTotal,
      expenses,
      invoices,
      proformas,
      purchaseOrders,
      commercialGstDocs,
    ] = await Promise.all([
      Asset.countDocuments({ isDeleted: false }),
      Contact.countDocuments({ isDeleted: false }),
      Asset.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Agreement.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Agreement.countDocuments({ isDeleted: false, status: 'ACTIVE', endDate: { $gte: in30 } }),
      Agreement.countDocuments({
        isDeleted: false,
        status: { $in: ['ACTIVE', 'EXPIRING'] },
        endDate: { $gte: now, $lt: in30 },
      }),
      Agreement.countDocuments({
        isDeleted: false,
        $or: [{ status: 'EXPIRED' }, { status: 'ACTIVE', endDate: { $lt: now } }],
      }),
      RepairTicket.countDocuments({ isDeleted: false, status: { $nin: ['CLOSED'] } }),
      RepairTicket.find({ isDeleted: false, status: { $nin: ['CLOSED'] } })
        .select('slaDueAt')
        .limit(200),
      Movement.countDocuments({ isDeleted: false, status: 'REQUESTED' }),
      Movement.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      VerificationRecord.countDocuments({ isDeleted: false, status: 'EXCEPTION' }),
      VerificationRecord.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      AssetRequest.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      AssetRequest.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$requestType', count: { $sum: 1 } } },
      ]),
      AssetRequest.countDocuments({ isDeleted: false, status: 'REQUESTED' }),
      CampOpsCamp.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      CampOpsCamp.countDocuments({ isDeleted: false }),
      FinanceExpense.find({ isDeleted: false }),
      FinanceInvoice.find({ isDeleted: false }),
      FinanceCommercialDocument.find({ isDeleted: false, documentType: 'proforma' }),
      FinanceCommercialDocument.find({ isDeleted: false, documentType: 'purchase_order' }),
      FinanceCommercialDocument.find({
        isDeleted: false,
        documentType: { $in: ['client_invoice', 'credit_note'] },
      }),
    ]);

    const slaBreached = (repairOpenItems || []).filter(
      (t) => t.slaDueAt && new Date(t.slaDueAt) < now
    ).length;

    const expenseTotal = sumAmount(expenses, 'amount');
    const expenseOpen = expenses.filter((r) =>
      ['Draft', 'Submitted', 'Approved'].includes(r.status)
    ).length;
    const invoiceTotal = sumAmount(invoices, 'totalAmount');
    const invoiceOpen = invoices.filter(
      (r) => r.status === 'Open' || r.status === 'Partially paid'
    ).length;
    const proformaDraft = proformas.filter(
      (r) => r.status === 'Draft' || r.status === 'Uploaded'
    ).length;
    const poDraft = purchaseOrders.filter(
      (r) => r.status === 'Draft' || r.status === 'Uploaded'
    ).length;
    const commercialDraft = (commercialGstDocs || []).filter((r) =>
      ['Draft', 'Uploaded', 'Submitted', 'Approved'].includes(r.status)
    ).length;
    const commercialSubmitted = [...proformas, ...purchaseOrders, ...(commercialGstDocs || [])].filter(
      (r) => r.status === 'Submitted'
    ).length;
    const clientInvoiceTotal = (commercialGstDocs || [])
      .filter((r) => r.documentType === 'client_invoice')
      .reduce((s, r) => s + (Number(r.grandTotal) || 0), 0);
    const clientInvoiceCount = (commercialGstDocs || []).filter(
      (r) => r.documentType === 'client_invoice'
    ).length;

    const assetsByStatus = countMap(assetsByStatusRows);
    const agreementsByStatus = countMap(agreementsByStatusRows);
    const movementsByStatus = countMap(movementsByStatusRows);
    const verificationByStatus = countMap(verificationByStatusRows);
    const requestsByStatus = countMap(requestsByStatusRows);
    const requestsByType = countMap(requestsByTypeRows);
    const campsByStatus = countMap(campsByStatusRows);

    const pending = [
      {
        id: 'requests',
        label: 'Request One awaiting approval',
        count: pendingRequests,
        severity: pendingRequests > 10 ? 'high' : pendingRequests > 0 ? 'medium' : 'ok',
        href: '/asset-requests',
        module: 'asset-requests',
      },
      {
        id: 'movements',
        label: 'Goods movements pending',
        count: pendingMovements,
        severity: pendingMovements > 5 ? 'high' : pendingMovements > 0 ? 'medium' : 'ok',
        href: '/logistics',
        module: 'logistics',
      },
      {
        id: 'repairs',
        label: 'Open repair tickets',
        count: openRepairs,
        severity: slaBreached > 0 ? 'critical' : openRepairs > 0 ? 'medium' : 'ok',
        href: '/asset-requests',
        module: 'asset-requests',
      },
      {
        id: 'finance-expenses',
        label: 'Open finance expenses',
        count: expenseOpen,
        severity: expenseOpen > 15 ? 'high' : expenseOpen > 0 ? 'medium' : 'ok',
        href: '/finance',
        module: 'finance',
      },
      {
        id: 'finance-invoices',
        label: 'Open / partial invoices',
        count: invoiceOpen,
        severity: invoiceOpen > 10 ? 'high' : invoiceOpen > 0 ? 'medium' : 'ok',
        href: '/finance',
        module: 'finance',
      },
      {
        id: 'docs-draft',
        label: 'Draft commercial documents',
        count: proformaDraft + poDraft + commercialDraft,
        severity: proformaDraft + poDraft + commercialDraft > 10 ? 'medium' : 'ok',
        href: '/finance',
        module: 'finance',
      },
      {
        id: 'docs-submitted',
        label: 'Commercial docs awaiting approval',
        count: commercialSubmitted,
        severity: commercialSubmitted > 5 ? 'high' : commercialSubmitted > 0 ? 'medium' : 'ok',
        href: '/finance',
        module: 'finance',
      },
    ].filter((p) => p.count > 0);

    const alerts = [];
    if (slaBreached > 0) {
      alerts.push({
        id: 'sla',
        severity: 'critical',
        label: 'Repair SLA breached',
        detail: `${slaBreached} open ticket${slaBreached === 1 ? '' : 's'} past SLA due date`,
        href: '/asset-requests',
        module: 'asset-requests',
      });
    }
    if (verificationExceptions > 0) {
      alerts.push({
        id: 'verify-exception',
        severity: 'high',
        label: 'Verification exceptions',
        detail: `${verificationExceptions} asset verification exception${verificationExceptions === 1 ? '' : 's'} need review`,
        href: '/verifications',
        module: 'verifications',
      });
    }
    if (agreementsExpired > 0) {
      alerts.push({
        id: 'agreements-expired',
        severity: 'high',
        label: 'Expired agreements',
        detail: `${agreementsExpired} agreement${agreementsExpired === 1 ? '' : 's'} expired or past end date`,
        href: '/agreements',
        module: 'agreements',
      });
    }
    if (agreementsExpiring > 0) {
      alerts.push({
        id: 'agreements-expiring',
        severity: 'medium',
        label: 'Agreements expiring in 30 days',
        detail: `${agreementsExpiring} active agreement${agreementsExpiring === 1 ? '' : 's'} due within 30 days`,
        href: '/agreements',
        module: 'agreements',
      });
    }
    if (pendingRequests > 15) {
      alerts.push({
        id: 'request-backlog',
        severity: 'medium',
        label: 'Request approval backlog',
        detail: `${pendingRequests} Request One items still awaiting approval`,
        href: '/asset-requests',
        module: 'asset-requests',
      });
    }

    const pendingTotal = pending.reduce((s, p) => s + p.count, 0);
    const health = healthFromSignals({ alerts, pendingTotal });

    const modules = [
      {
        id: 'assets',
        label: 'Asset One',
        href: '/asset-inventory',
        primary: assetCount,
        primaryLabel: 'Assets',
        secondary: Object.keys(assetsByStatus).length,
        secondaryLabel: 'Statuses',
        status: 'ok',
      },
      {
        id: 'agreements',
        label: 'Document One',
        href: '/agreements',
        primary: agreementsActive + agreementsExpiring + agreementsExpired,
        primaryLabel: 'Agreements',
        secondary: agreementsExpiring + agreementsExpired,
        secondaryLabel: 'Expiring / expired',
        status: agreementsExpired > 0 ? 'critical' : agreementsExpiring > 0 ? 'warn' : 'ok',
      },
      {
        id: 'verifications',
        label: 'Verification One',
        href: '/verifications',
        primary: Object.values(verificationByStatus).reduce((s, n) => s + n, 0),
        primaryLabel: 'Records',
        secondary: verificationExceptions,
        secondaryLabel: 'Exceptions',
        status: verificationExceptions > 0 ? 'warn' : 'ok',
      },
      {
        id: 'camps',
        label: 'Camp One',
        href: '/camps/manage',
        primary: campTotal,
        primaryLabel: 'Camps',
        secondary: Object.keys(campsByStatus).length,
        secondaryLabel: 'Statuses',
        status: 'ok',
      },
      {
        id: 'asset-requests',
        label: 'Request One',
        href: '/asset-requests',
        primary: pendingRequests,
        primaryLabel: 'Pending',
        secondary: Object.values(requestsByStatus).reduce((s, n) => s + n, 0),
        secondaryLabel: 'Total',
        status: pendingRequests > 10 ? 'warn' : 'ok',
      },
      {
        id: 'logistics',
        label: 'Movement One',
        href: '/logistics',
        primary: pendingMovements,
        primaryLabel: 'Pending',
        secondary: Object.values(movementsByStatus).reduce((s, n) => s + n, 0),
        secondaryLabel: 'Movements',
        status: pendingMovements > 5 ? 'warn' : 'ok',
      },
      {
        id: 'finance',
        label: 'Finance One',
        href: '/finance',
        primary: invoiceOpen + expenseOpen,
        primaryLabel: 'Open items',
        secondary: expenses.length + invoices.length,
        secondaryLabel: 'Docs',
        status: invoiceOpen + expenseOpen > 15 ? 'warn' : 'ok',
      },
      {
        id: 'contacts',
        label: 'Contact Directory',
        href: '/master-data?scope=document&entity=contacts',
        primary: contactCount,
        primaryLabel: 'Contacts',
        secondary: 0,
        secondaryLabel: '',
        status: 'ok',
      },
    ];

    res.json({
      data: {
        generatedAt: now.toISOString(),
        health,
        kpis: [
          { id: 'assets', label: 'Assets', value: assetCount, href: '/asset-inventory' },
          {
            id: 'contacts',
            label: 'Contacts',
            value: contactCount,
            href: '/master-data?scope=document&entity=contacts',
          },
          { id: 'pending-requests', label: 'Pending requests', value: pendingRequests, href: '/asset-requests', tone: pendingRequests ? 'warn' : 'ok' },
          { id: 'open-repairs', label: 'Open repairs', value: openRepairs, href: '/asset-requests', tone: slaBreached ? 'critical' : openRepairs ? 'warn' : 'ok' },
          { id: 'verify-exceptions', label: 'Verify exceptions', value: verificationExceptions, href: '/verifications', tone: verificationExceptions ? 'warn' : 'ok' },
          { id: 'camps', label: 'Camps', value: campTotal, href: '/camps/manage' },
          { id: 'expense-total', label: 'Expense total (INR)', value: Math.round(expenseTotal), href: '/finance', format: 'currency' },
          { id: 'invoice-open', label: 'Open invoices', value: invoiceOpen, href: '/finance', tone: invoiceOpen ? 'warn' : 'ok' },
        ],
        pending,
        alerts,
        financials: {
          expenseCount: expenses.length,
          expenseTotal: Math.round(expenseTotal * 100) / 100,
          expenseOpen,
          invoiceCount: invoices.length,
          invoiceTotal: Math.round(invoiceTotal * 100) / 100,
          invoiceOpen,
          proformaCount: proformas.length,
          proformaDraft,
          purchaseOrderCount: purchaseOrders.length,
          purchaseOrderDraft: poDraft,
          clientInvoiceCount,
          clientInvoiceTotal: Math.round(clientInvoiceTotal * 100) / 100,
          commercialDraft,
          commercialSubmitted,
        },
        agreementsHealth: {
          active: agreementsActive,
          expiring: agreementsExpiring,
          expired: agreementsExpired,
        },
        repairsSla: {
          openCount: openRepairs,
          breached: slaBreached,
        },
        modules,
        breakdowns: {
          assetsByStatus,
          agreementsByStatus,
          movementsByStatus,
          verificationByStatus,
          requestsByStatus,
          requestsByType,
          campsByStatus,
        },
      },
    });
  })
);

router.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const [
      assetsByStatus,
      agreementByStatus,
      openRepairs,
      pendingMovements,
      contactCount,
      assetCount,
      verificationExceptions,
    ] = await Promise.all([
      Asset.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Agreement.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      RepairTicket.countDocuments({
        isDeleted: false,
        status: { $nin: ['CLOSED'] },
      }),
      Movement.countDocuments({ isDeleted: false, status: 'REQUESTED' }),
      Contact.countDocuments({ isDeleted: false }),
      Asset.countDocuments({ isDeleted: false }),
      VerificationRecord.countDocuments({ isDeleted: false, status: 'EXCEPTION' }),
    ]);

    res.json({
      data: {
        assetCount,
        contactCount,
        hcwCount: contactCount,
        openRepairs,
        pendingMovements,
        verificationExceptions,
        assetsByStatus: Object.fromEntries(assetsByStatus.map((x) => [x._id, x.count])),
        agreementsByStatus: Object.fromEntries(agreementByStatus.map((x) => [x._id, x.count])),
      },
    });
  })
);

/** Tracking board: Asset Registry status (Qty + Value) + Asset Verification (Qty + Value) */
router.get(
  '/tracking',
  asyncHandler(async (req, res) => {
    const fromRaw = req.query.from ? String(req.query.from).trim() : '';
    const toRaw = req.query.to ? String(req.query.to).trim() : '';

    const parseDay = (raw, endOfDay = false) => {
      if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
      const [y, m, d] = raw.split('-').map(Number);
      if (endOfDay) return new Date(y, m - 1, d, 23, 59, 59, 999);
      return new Date(y, m - 1, d, 0, 0, 0, 0);
    };

    const fromDate = parseDay(fromRaw, false);
    const toDate = parseDay(toRaw, true);

    if ((fromRaw && !fromDate) || (toRaw && !toDate)) {
      return res.status(400).json({
        error: { message: 'from and to must be YYYY-MM-DD', code: 'VALIDATION_ERROR' },
      });
    }
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      return res.status(400).json({
        error: { message: 'from must be on or before to', code: 'VALIDATION_ERROR' },
      });
    }

    // Verification period = month of `to` (or explicit periodKey / today)
    const periodKey = String(
      req.query.periodKey ||
        (toDate
          ? `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}`
          : periodKeyFromDate())
    ).trim();
    const [py, pm] = periodKey.split('-').map(Number);
    const periodAnchor = toDate || new Date(py, (pm || 1) - 1, Math.min(new Date().getDate(), 28));

    const assetOnboardDate = (a) => {
      if (a.purchaseDate) {
        const d = new Date(a.purchaseDate);
        if (!Number.isNaN(d.getTime())) return d;
      }
      const added = String(a.addedMonth || '');
      if (/^(0[1-9]|1[0-2])\/\d{4}$/.test(added)) {
        const [mm, yyyy] = added.split('/');
        return new Date(Number(yyyy), Number(mm) - 1, 1);
      }
      if (a.createdAt) {
        const d = new Date(a.createdAt);
        if (!Number.isNaN(d.getTime())) return d;
      }
      return null;
    };

    const inRange = (a) => {
      if (!fromDate && !toDate) return true;
      const onboard = assetOnboardDate(a);
      if (!onboard) return false;
      if (fromDate && onboard.getTime() < fromDate.getTime()) return false;
      if (toDate && onboard.getTime() > toDate.getTime()) return false;
      return true;
    };

    const assets = (await Asset.find({ isDeleted: false }).sort('-updatedAt')).filter(inRange);

    const assetValue = (a) => {
      const n = Number(a.deviceValue);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };

    const statusBuckets = Object.fromEntries(
      ASSET_STATUS_OPTIONS.map((status) => [status, { status, qty: 0, value: 0 }])
    );
    let inventoryQty = 0;
    let inventoryValue = 0;

    for (const asset of assets) {
      const raw = String(asset.agreementStatus || 'Not Initiated').trim();
      const status =
        raw.toLowerCase() === 'active'
          ? 'Agreement Signed'
          : ASSET_STATUS_OPTIONS.includes(raw)
            ? raw
            : raw || 'Not Initiated';
      const qty = 1;
      const value = assetValue(asset);
      inventoryQty += qty;
      inventoryValue += value;
      if (!statusBuckets[status]) {
        statusBuckets[status] = { status, qty: 0, value: 0 };
      }
      statusBuckets[status].qty += qty;
      statusBuckets[status].value += value;
    }

    // Canonical 8 statuses first, then any legacy extras
    const assetStatus = [
      ...ASSET_STATUS_OPTIONS.map((status) => statusBuckets[status]),
      ...Object.values(statusBuckets).filter((b) => !ASSET_STATUS_OPTIONS.includes(b.status)),
    ];

    const signed = assets.filter(isVerificationOneEligibleAsset);

    const campaign = await ensureCampaign(periodKey, req.user._id);
    const verificationMap = {
      SAFE: { key: 'SAFE', label: 'Safe', qty: 0, value: 0 },
      CAUTION: { key: 'CAUTION', label: 'Caution', qty: 0, value: 0 },
      DANGER: { key: 'DANGER', label: 'Danger', qty: 0, value: 0 },
    };

    for (const asset of signed) {
      const record = await ensureRecord(campaign, asset, req.user._id);
      const condition = computeDeviceCondition(asset, record, periodAnchor);
      const bucket = verificationMap[condition.condition] || verificationMap.DANGER;
      bucket.qty += 1;
      bucket.value += assetValue(asset);
    }

    const verification = ['SAFE', 'CAUTION', 'DANGER'].map((k) => verificationMap[k]);
    const verificationTotals = {
      qty: verification.reduce((s, r) => s + r.qty, 0),
      value: verification.reduce((s, r) => s + r.value, 0),
    };

    const showValue = hasPermission(req, PERMISSIONS.ASSETS_VIEW_VALUE);
    const mapStatus = (row) =>
      showValue ? row : { status: row.status, qty: row.qty };
    const mapCondition = (row) =>
      showValue
        ? row
        : { key: row.key, label: row.label, qty: row.qty };

    res.json({
      data: {
        periodKey,
        from: fromRaw || null,
        to: toRaw || null,
        inventory: {
          qty: inventoryQty,
          value: showValue ? inventoryValue : undefined,
          statuses: assetStatus.map(mapStatus),
        },
        verification: {
          qty: verificationTotals.qty,
          value: showValue ? verificationTotals.value : undefined,
          conditions: verification.map(mapCondition),
        },
      },
    });
  })
);

router.get(
  '/export',
  asyncHandler(async (_req, res) => {
    const [
      assetCount,
      contactCount,
      agreementCount,
      templateCount,
      signatureCount,
      roleCount,
      userCount,
      openRepairs,
      pendingMovements,
      verificationExceptions,
      assetsByStatus,
      agreementsByStatus,
      movementsByStatus,
      verificationByStatus,
    ] = await Promise.all([
      Asset.countDocuments({ isDeleted: false }),
      Contact.countDocuments({ isDeleted: false }),
      Agreement.countDocuments({ isDeleted: false }),
      DocumentTemplate.countDocuments({ isDeleted: false }),
      SignatureMaster.countDocuments({ isDeleted: false }),
      Role.countDocuments({ isDeleted: false }),
      User.countDocuments({ isDeleted: false }),
      RepairTicket.countDocuments({ isDeleted: false, status: { $nin: ['CLOSED'] } }),
      Movement.countDocuments({ isDeleted: false, status: 'REQUESTED' }),
      VerificationRecord.countDocuments({ isDeleted: false, status: 'EXCEPTION' }),
      Asset.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Agreement.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Movement.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      VerificationRecord.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const exportedAt = new Date().toISOString();

    sendMultiSheetExcel(res, 'TYLO_One_Dashboard_Summary.xlsx', [
      {
        name: 'Summary',
        headers: ['Metric', 'Count'],
        rows: [
          ['Exported At', exportedAt],
          ['Asset Registry', assetCount],
          ['Contacts', contactCount],
          ['Agreements', agreementCount],
          ['Document Templates', templateCount],
          ['Signatures', signatureCount],
          ['Roles', roleCount],
          ['Users', userCount],
          ['Open Repairs', openRepairs],
          ['Pending Movements', pendingMovements],
          ['Verification Exceptions', verificationExceptions],
        ],
      },
      {
        name: 'Assets by Status',
        headers: ['Status', 'Count'],
        rows: assetsByStatus.map((x) => [x._id || '-', x.count]),
      },
      {
        name: 'Agreements by Status',
        headers: ['Status', 'Count'],
        rows: agreementsByStatus.map((x) => [x._id || '-', x.count]),
      },
      {
        name: 'Movements by Status',
        headers: ['Status', 'Count'],
        rows: movementsByStatus.map((x) => [x._id || '-', x.count]),
      },
      {
        name: 'Verifications by Status',
        headers: ['Status', 'Count'],
        rows: verificationByStatus.map((x) => [x._id || '-', x.count]),
      },
    ]);
  })
);

router.get(
  '/verification-compliance',
  asyncHandler(async (req, res) => {
    const periodKey = req.query.periodKey;
    const match = { isDeleted: false };
    if (periodKey) match.periodKey = periodKey;
    const rows = await VerificationRecord.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    res.json({ data: Object.fromEntries(rows.map((r) => [r._id, r.count])) });
  })
);

router.get(
  '/agreements-health',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const [active, expiring, expired] = await Promise.all([
      Agreement.countDocuments({ isDeleted: false, status: 'ACTIVE', endDate: { $gte: in30 } }),
      Agreement.countDocuments({
        isDeleted: false,
        status: { $in: ['ACTIVE', 'EXPIRING'] },
        endDate: { $gte: now, $lt: in30 },
      }),
      Agreement.countDocuments({
        isDeleted: false,
        $or: [{ status: 'EXPIRED' }, { status: 'ACTIVE', endDate: { $lt: now } }],
      }),
    ]);
    res.json({ data: { active, expiring, expired } });
  })
);

router.get(
  '/repairs-sla',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const open = await RepairTicket.find({
      isDeleted: false,
      status: { $nin: ['CLOSED'] },
    })
      .select('ticketNumber status slaDueAt priority assetId')
      .populate('assetId', 'assetTag')
      .limit(50)
      .sort({ slaDueAt: 1 });
    const breached = open.filter((t) => t.slaDueAt && t.slaDueAt < now).length;
    res.json({ data: { openCount: open.length, breached, items: open } });
  })
);

router.get(
  '/movements-pipeline',
  asyncHandler(async (_req, res) => {
    const rows = await Movement.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    res.json({ data: Object.fromEntries(rows.map((r) => [r._id, r.count])) });
  })
);

export default router;
