/**
 * Operations Dashboard → Overview KPI board.
 * Reuses existing aggregations / lifecycle helpers; no schema changes.
 */
import { Asset } from '../assets/asset.model.js';
import { Contact } from '../contacts/contact.model.js';
import { CampOpsCamp } from '../campOps/campOps.model.js';
import {
  FinanceExpense,
  FinanceCommercialDocument,
} from '../finance/finance.model.js';
import { ASSET_STATUS_OPTIONS } from '../devices/device.constants.js';
import { resolveCampClientScope } from '../campOps/campOps.clientAccess.js';
import { applyAssignedUserAssignmentsToFilter } from '../campOps/clientMaster.programScope.js';
import {
  isExecutionCancellationForFinance,
  resolveCancelledClosureExecutionStatus,
} from '../campOps/campOps.lifecycle.js';
import { isCampScheduleEligible } from './campSchedule.js';
import {
  classifyChargeabilityBucket,
  classifyPunctualityBucket,
} from './campQuality.metrics.js';
import {
  trackingInventoryByStatusPipeline,
  trackingVerificationByConditionPipeline,
  formatTrackingInventoryBuckets,
  formatTrackingVerificationBuckets,
} from './dashboard.aggregations.js';
import { periodKeyFromDate } from '../verifications/verification.condition.js';
import { VerificationCampaign } from '../verifications/verification.model.js';
import { buildDashboard } from '../logistics/logistics.dashboard.js';
import { listUsageMerged } from '../logistics/logistics.usage.js';
import { AppError } from '../../utils/helpers.js';

const OUTSTANDING_PAYMENT_STATUSES = new Set([
  'Unpaid',
  'Unpaid under 30D',
  'Unpaid over 30D',
  'Partially Paid',
]);

const ASSET_KPI_STATUSES = [
  'Tylo Office',
  'Lost/Stolen',
  'Agreement Signed',
  'Not Initiated',
  'Under Repairs',
  'Untraceable',
  'End of Life',
];

function parseDay(raw, endOfDay = false) {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  if (endOfDay) return new Date(y, m - 1, d, 23, 59, 59, 999);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function parseOpsOverviewRange(query = {}) {
  const fromRaw = String(query.from || query.dateFrom || '').trim();
  const toRaw = String(query.to || query.dateTo || '').trim();
  const fromDate = parseDay(fromRaw, false);
  const toDate = parseDay(toRaw, true);
  if ((fromRaw && !fromDate) || (toRaw && !toDate)) {
    throw new AppError('from and to must be YYYY-MM-DD', 400, 'VALIDATION_ERROR');
  }
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    throw new AppError('from must be on or before to', 400, 'VALIDATION_ERROR');
  }
  return {
    fromRaw: fromRaw || null,
    toRaw: toRaw || null,
    fromDate,
    toDate,
    fromIso: fromRaw || '',
    toIso: toRaw || '',
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pct(part, total) {
  if (!total) return 0;
  return round2((Number(part) / Number(total)) * 100);
}

function withShare(row, totalQty, totalValue) {
  return {
    ...row,
    pctQty: pct(row.qty, totalQty),
    pctValue: totalValue > 0 ? pct(row.value || 0, totalValue) : null,
  };
}

function hrefAsset(status) {
  return `/asset-one?agreementStatus=${encodeURIComponent(status)}`;
}

function hrefVerification(key) {
  return `/verification-one?condition=${encodeURIComponent(key)}`;
}

function hrefCamp({ fromIso, toIso, status = '', metric = '' }) {
  const params = new URLSearchParams();
  if (fromIso) params.set('dateFrom', fromIso);
  if (toIso) params.set('dateTo', toIso);
  if (status) params.set('status', status);
  if (metric) params.set('metric', metric);
  const q = params.toString();
  return q ? `/camp-one/manage?${q}` : '/camp-one/manage';
}

function hrefMaster({ fromIso, toIso, cohort }) {
  const params = new URLSearchParams({
    scope: 'document',
    entity: 'contacts',
    contactCategory: 'Healthcare Worker',
  });
  if (cohort) params.set('hcwCohort', cohort);
  if (fromIso) params.set('createdFrom', fromIso);
  if (toIso) params.set('createdTo', toIso);
  return `/master-one?${params}`;
}

function hrefMovement(kind, fromIso, toIso) {
  const base = kind === 'outward' ? '/movement-one/outward' : '/movement-one/inward';
  const params = new URLSearchParams();
  if (fromIso) params.set('dateFrom', fromIso);
  if (toIso) params.set('dateTo', toIso);
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}

function hrefFinanceInvoice({ fromIso, toIso, paymentStatus = '' }) {
  const params = new URLSearchParams();
  if (fromIso) params.set('from', fromIso);
  if (toIso) params.set('to', toIso);
  if (paymentStatus) params.set('paymentStatus', paymentStatus);
  const q = params.toString();
  return q ? `/finance-one/billing/invoice?${q}` : '/finance-one/billing/invoice';
}

function hrefFinanceExpenses(fromIso, toIso) {
  const params = new URLSearchParams();
  if (fromIso) params.set('from', fromIso);
  if (toIso) params.set('to', toIso);
  const q = params.toString();
  return q ? `/finance-one/payouts?${q}` : '/finance-one/payouts';
}

export function isCancelledByTyloCamp(camp = {}) {
  if (!isExecutionCancellationForFinance(camp)) return false;
  return resolveCancelledClosureExecutionStatus(camp) === 'Cancelled by Tylo';
}

export function isCancelledByClientCamp(camp = {}) {
  if (!isExecutionCancellationForFinance(camp)) return false;
  return resolveCancelledClosureExecutionStatus(camp) === 'Cancelled by Client';
}

/** Eligible scheduled = schedule-eligible OR cancelled (so cancellations stay in the base). */
export function isEligibleScheduledCamp(camp = {}, now = new Date()) {
  if (camp?.isDeleted) return false;
  if (isExecutionCancellationForFinance(camp)) return true;
  return isCampScheduleEligible(camp, now);
}

export function summarizeCampOverviewKpis(camps = [], { fromIso = '', toIso = '' } = {}) {
  const now = new Date();
  const eligible = camps.filter((camp) => isEligibleScheduledCamp(camp, now));
  const eligibleTotal = eligible.length;

  const chargeCounts = { Pending: 0, Chargeable: 0, 'Non-Chargeable': 0 };
  const punctCounts = { Pending: 0, Cancelled: 0, Good: 0, Average: 0, Poor: 0 };
  let cancelledTylo = 0;
  let cancelledClient = 0;

  for (const camp of eligible) {
    const charge = classifyChargeabilityBucket(camp.chargeableStatus);
    chargeCounts[charge] = (chargeCounts[charge] || 0) + 1;
    const punct = classifyPunctualityBucket(camp);
    punctCounts[punct] = (punctCounts[punct] || 0) + 1;
    if (isCancelledByTyloCamp(camp)) cancelledTylo += 1;
    else if (isCancelledByClientCamp(camp)) cancelledClient += 1;
  }

  const cancelledTotal = cancelledTylo + cancelledClient;

  return {
    eligibleTotal,
    chargeability: Object.entries(chargeCounts).map(([key, qty]) => ({
      key,
      label: key,
      qty,
      pct: pct(qty, eligibleTotal),
      href: hrefCamp({ fromIso, toIso, metric: 'chargeability' }),
    })),
    punctuality: Object.entries(punctCounts).map(([key, qty]) => ({
      key,
      label: key,
      qty,
      pct: pct(qty, eligibleTotal),
      href: hrefCamp({ fromIso, toIso, metric: 'punctuality' }),
    })),
    cancellation: {
      eligibleTotal,
      cancelledTotal,
      ratePct: pct(cancelledTotal, eligibleTotal),
      byTylo: {
        qty: cancelledTylo,
        pct: pct(cancelledTylo, eligibleTotal),
        href: hrefCamp({ fromIso, toIso, status: 'cancelled_by_tylo' }),
      },
      byClient: {
        qty: cancelledClient,
        pct: pct(cancelledClient, eligibleTotal),
        href: hrefCamp({ fromIso, toIso, status: 'cancelled_by_client' }),
      },
      href: hrefCamp({ fromIso, toIso }),
    },
  };
}

export function computeClientInvoiceOutstanding(invoices = [], creditNotes = []) {
  let grossOutstanding = 0;
  let invoiceCount = 0;
  const openInvoiceNumbers = new Set();

  for (const inv of invoices) {
    const status = String(inv.paymentStatus || '').trim();
    if (!OUTSTANDING_PAYMENT_STATUSES.has(status) && !/^unpaid/i.test(status)) continue;
    if (status === 'Paid') continue;
    const grand = Number(inv.grandTotal) || 0;
    const paid = Number(inv.paidAmount) || 0;
    const balance = Math.max(0, round2(grand - paid));
    if (balance <= 0) continue;
    grossOutstanding += balance;
    invoiceCount += 1;
    const docNo = String(inv.documentNumber || '').trim();
    if (docNo) openInvoiceNumbers.add(docNo.toLowerCase());
  }

  let creditApplied = 0;
  for (const note of creditNotes) {
    const stage = String(note.status || '').trim();
    if (['Cancelled', 'Draft'].includes(stage)) continue;
    const pay = String(note.paymentStatus || '').trim();
    if (pay === 'Adjusted' || pay === 'Refunded') continue;
    const amount = Math.abs(Number(note.grandTotal) || 0);
    if (!(amount > 0)) continue;
    const ref = String(note.reference || '').trim().toLowerCase();
    if (ref && openInvoiceNumbers.size) {
      if (openInvoiceNumbers.has(ref)) creditApplied += amount;
      continue;
    }
    // Unlinked issued credits still reduce the outstanding pool (best-effort).
    if (['Issued', 'Approved'].includes(stage) || pay === 'Pending Adjustment' || pay === 'Partially Adjusted') {
      creditApplied += amount;
    }
  }

  creditApplied = round2(creditApplied);
  const net = Math.max(0, round2(grossOutstanding - creditApplied));
  return {
    invoiceCount,
    grossOutstanding: round2(grossOutstanding),
    creditApplied,
    outstanding: net,
  };
}

async function loadAssetModule({ showValue }) {
  // 1A current-state snapshot — no onboard date filter.
  const rows = await Asset.aggregate(trackingInventoryByStatusPipeline(null, null));
  const { inventoryQty, inventoryValue, assetStatus } = formatTrackingInventoryBuckets(
    rows,
    ASSET_STATUS_OPTIONS,
  );
  const byStatus = new Map(assetStatus.map((row) => [row.status, row]));
  const statuses = ASSET_KPI_STATUSES.map((status) => {
    const row = byStatus.get(status) || { status, qty: 0, value: 0 };
    const next = withShare(
      {
        status,
        qty: row.qty || 0,
        value: showValue ? round2(row.value || 0) : undefined,
        href: hrefAsset(status),
      },
      inventoryQty,
      inventoryValue,
    );
    if (!showValue) {
      delete next.value;
      delete next.pctValue;
    }
    return next;
  });
  return {
    id: 'asset-one',
    label: 'Asset One',
    snapshot: true,
    totalQty: inventoryQty,
    totalValue: showValue ? round2(inventoryValue) : undefined,
    statuses,
  };
}

async function loadVerificationModule({ fromDate, toDate, toRaw, showValue }) {
  const periodKey = String(
    toDate
      ? `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}`
      : periodKeyFromDate(),
  ).trim();
  const [py, pm] = periodKey.split('-').map(Number);
  const periodAnchor = toDate || new Date(py, (pm || 1) - 1, Math.min(new Date().getDate(), 28));
  const campaign = await VerificationCampaign.findOne({ periodKey, isDeleted: false });
  const rows = await Asset.aggregate(
    trackingVerificationByConditionPipeline(
      fromDate,
      toDate,
      campaign?._id || null,
      periodAnchor,
    ),
  );
  const { verification, verificationTotals } = formatTrackingVerificationBuckets(rows);
  const conditions = verification.map((row) => {
    const next = withShare(
      {
        key: row.key,
        label: row.label,
        qty: row.qty || 0,
        value: showValue ? round2(row.value || 0) : undefined,
        href: hrefVerification(row.key),
      },
      verificationTotals.qty,
      verificationTotals.value,
    );
    if (!showValue) {
      delete next.value;
      delete next.pctValue;
    }
    return next;
  });
  return {
    id: 'verification-one',
    label: 'Verification One',
    periodKey,
    asOf: toRaw || null,
    totalQty: verificationTotals.qty,
    totalValue: showValue ? round2(verificationTotals.value) : undefined,
    conditions,
  };
}

async function loadCampModule({ fromIso, toIso, user }) {
  let filter = { isDeleted: false };
  if (fromIso || toIso) {
    filter.campDate = {};
    if (fromIso) filter.campDate.$gte = fromIso;
    if (toIso) filter.campDate.$lte = toIso;
  }
  const programScope = await resolveCampClientScope(user || {});
  if (programScope) {
    filter = applyAssignedUserAssignmentsToFilter(filter, programScope);
  }
  const camps = await CampOpsCamp.find(filter)
    .select([
      'campDate',
      'status',
      'lifecycleStage',
      'assignmentStatus',
      'assignmentDecision',
      'executionStatus',
      'effectiveExecutionStatus',
      'financePaymentStatus',
      'paymentSubmitStatus',
      'cancellationSource',
      'cancelledBy',
      'assignmentRefusalReason',
      'requestReviewStatus',
      'requestIncomplete',
      'submittedAt',
      'chargeableStatus',
      'punctuality',
      'startTime',
      'inTime',
      'isDeleted',
    ].join(' '))
    .lean();
  return {
    id: 'camp-one',
    label: 'Camp One',
    ...summarizeCampOverviewKpis(camps || [], { fromIso, toIso }),
  };
}

async function loadMasterModule({ fromDate, toDate, fromIso, toIso }) {
  const base = { isDeleted: false, contactCategory: 'Healthcare Worker' };

  if (!fromDate && !toDate) {
    const total = await Contact.countDocuments(base);
    return {
      id: 'master-one',
      label: 'Master One',
      newHcws: {
        qty: 0,
        pct: 0,
        href: hrefMaster({ fromIso, toIso, cohort: 'new' }),
      },
      existingHcws: {
        qty: 0,
        pct: 0,
        href: hrefMaster({ fromIso: '', toIso: '', cohort: 'existing' }),
      },
      total,
      requiresDateRange: true,
    };
  }

  const newFilter = { ...base, createdAt: {} };
  if (fromDate) newFilter.createdAt.$gte = fromDate;
  if (toDate) newFilter.createdAt.$lte = toDate;

  const [newCount, existingCount] = await Promise.all([
    Contact.countDocuments(newFilter),
    fromDate
      ? Contact.countDocuments({ ...base, createdAt: { $lt: fromDate } })
      : Promise.resolve(0),
  ]);

  const existing = fromDate ? existingCount : 0;
  const total = newCount + existing;
  return {
    id: 'master-one',
    label: 'Master One',
    newHcws: {
      qty: newCount,
      pct: pct(newCount, total),
      href: hrefMaster({ fromIso, toIso, cohort: 'new' }),
    },
    existingHcws: {
      qty: existing,
      pct: pct(existing, total),
      href: hrefMaster({ fromIso: '', toIso: fromIso || '', cohort: 'existing' }),
    },
    total,
  };
}

async function loadMovementModule({ fromIso, toIso }) {
  const { queryCollection } = await import('../../store/persistence.js');
  const [{ data: rows }, usageRows] = await Promise.all([
    queryCollection('logistics_in_out_entries', {
      filter: { isDeleted: false },
      limit: 5000,
      sort: { createdAt: -1 },
    }),
    listUsageMerged(),
  ]);
  const board = buildDashboard(rows || [], usageRows || [], {
    dateFrom: fromIso || undefined,
    dateTo: toIso || undefined,
  });
  const k = board.kpis || {};
  return {
    id: 'movement-one',
    label: 'Movement One',
    combinedWarehouses: true,
    inward: {
      qty: k.inwardQty || 0,
      value: round2(k.inwardAmount || 0),
      href: hrefMovement('inward', fromIso, toIso),
    },
    outward: {
      qty: k.outwardQty || 0,
      value: round2(k.outwardAmount || 0),
      href: hrefMovement('outward', fromIso, toIso),
    },
    closingBalance: {
      qty: k.balanceQty || 0,
      value: round2(k.balanceAmount || 0),
      href: hrefMovement('inward', fromIso, toIso),
      logic: board.logic?.balance || 'Inward − Outward (all warehouses; transfers excluded)',
    },
  };
}

async function loadFinanceModule({ fromIso, toIso }) {
  const invoiceMatch = {
    isDeleted: false,
    documentType: 'client_invoice',
    status: { $nin: ['Cancelled', 'Draft'] },
  };
  if (fromIso || toIso) {
    invoiceMatch.documentDate = {};
    if (fromIso) invoiceMatch.documentDate.$gte = fromIso;
    if (toIso) invoiceMatch.documentDate.$lte = toIso;
  }

  const creditMatch = {
    isDeleted: false,
    documentType: 'credit_note',
    status: { $nin: ['Cancelled', 'Draft'] },
  };
  if (fromIso || toIso) {
    creditMatch.documentDate = {};
    if (fromIso) creditMatch.documentDate.$gte = fromIso;
    if (toIso) creditMatch.documentDate.$lte = toIso;
  }

  const expenseMatch = { isDeleted: false };
  if (fromIso || toIso) {
    expenseMatch.expenseDate = {};
    if (fromIso) expenseMatch.expenseDate.$gte = fromIso;
    if (toIso) expenseMatch.expenseDate.$lte = toIso;
  }

  const [invoiceAgg, invoices, credits, expenseAgg] = await Promise.all([
    FinanceCommercialDocument.aggregate([
      { $match: invoiceMatch },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          total: { $sum: { $ifNull: ['$grandTotal', 0] } },
        },
      },
    ]),
    FinanceCommercialDocument.find({
      isDeleted: false,
      documentType: 'client_invoice',
      status: { $nin: ['Cancelled', 'Draft'] },
    })
      .select('documentNumber grandTotal paidAmount paymentStatus status documentDate')
      .lean(),
    FinanceCommercialDocument.find(creditMatch)
      .select('documentNumber reference grandTotal paymentStatus status documentDate')
      .lean(),
    FinanceExpense.aggregate([
      { $match: expenseMatch },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          total: { $sum: { $ifNull: ['$amount', 0] } },
        },
      },
    ]),
  ]);

  // Outstanding is current open AR (not limited to invoices issued only in range),
  // then credits in range / linked by reference reduce the balance.
  const outstanding = computeClientInvoiceOutstanding(invoices || [], credits || []);
  const revenueRow = Array.isArray(invoiceAgg) && invoiceAgg[0] ? invoiceAgg[0] : {};
  const expenseRow = Array.isArray(expenseAgg) && expenseAgg[0] ? expenseAgg[0] : {};

  return {
    id: 'finance-one',
    label: 'Finance One',
    revenue: {
      qty: revenueRow.count || 0,
      value: round2(revenueRow.total || 0),
      href: hrefFinanceInvoice({ fromIso, toIso }),
    },
    outstanding: {
      qty: outstanding.invoiceCount,
      value: outstanding.outstanding,
      gross: outstanding.grossOutstanding,
      creditsApplied: outstanding.creditApplied,
      href: hrefFinanceInvoice({ paymentStatus: 'Unpaid under 30D' }),
    },
    cost: {
      qty: expenseRow.count || 0,
      value: round2(expenseRow.total || 0),
      href: hrefFinanceExpenses(fromIso, toIso),
    },
  };
}

export function opsOverviewLimitations({ fromIso }) {
  const notes = [
    'Asset status is a current-state snapshot (agreementStatus), not a reconstructed history as of Date To.',
    'Movement closing balance is period Inward − Outward across warehouses (ledger scan capped at 5,000 rows), not lot reconstruction as of Date To.',
    'Outstanding credits reduce AR when credit-note reference matches an open invoice number; unlinked issued credits reduce the pool as a best-effort net.',
  ];
  if (!fromIso) {
    notes.push('Existing HCWs require Date From (contacts created before From). Without From, Existing is reported as 0.');
  }
  return notes;
}

export async function loadOpsOverviewKpis({ query = {}, user = null, showAssetValue = false } = {}) {
  const range = parseOpsOverviewRange(query);
  const { fromRaw, toRaw, fromDate, toDate, fromIso, toIso } = range;

  const [assetOne, verificationOne, campOne, masterOne, movementOne, financeOne] = await Promise.all([
    loadAssetModule({ showValue: showAssetValue }),
    loadVerificationModule({ fromDate, toDate, toRaw, showValue: showAssetValue }),
    loadCampModule({ fromIso, toIso, user }),
    loadMasterModule({ fromDate, toDate, fromIso, toIso }),
    loadMovementModule({ fromIso, toIso }),
    loadFinanceModule({ fromIso, toIso }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    from: fromRaw,
    to: toRaw,
    limitations: opsOverviewLimitations({ fromIso }),
    modules: {
      assetOne,
      verificationOne,
      campOne,
      masterOne,
      movementOne,
      financeOne,
    },
  };
}
