/** Dashboard aggregations for Inventory & Logistics */

const INWARD_TYPES = new Set([
  'Inward',
  'Inward to Warehouse',
  'Inward to Lotus',
  'Return',
]);

const OUTWARD_TYPES = new Set([
  'Outward',
  'Outward from Warehouse',
  'Outward from Lotus',
  'Transfer',
]);

export function isInwardEntry(entryType) {
  const t = String(entryType || '').trim();
  if (INWARD_TYPES.has(t)) return true;
  return /^inward/i.test(t);
}

export function isOutwardEntry(entryType) {
  const t = String(entryType || '').trim();
  if (OUTWARD_TYPES.has(t)) return true;
  return /^outward/i.test(t);
}

export function lineQty(row) {
  const n = Number(row?.qty);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

export function lineAmount(row) {
  const inv = Number(row?.invoiceAmount);
  if (Number.isFinite(inv) && inv !== 0) return Math.abs(inv);
  const unit = Number(row?.perUnitCost) || 0;
  return lineQty(row) * Math.abs(unit);
}

export function productLabel(row) {
  return (
    String(row?.productName || row?.itemName || row?.deviceName || row?.partName || '').trim() ||
    'Unknown'
  );
}

export function parseTxnDate(row) {
  const raw = row?.transactionDate || row?.transactionDateTime || row?.campDate || row?.createdAt || '';
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function monthKey(d) {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Field-balance expiry categories (product rule):
 * - Expired: past date
 * - Safe: 12+ months remaining
 * - Critical: 6–12 months remaining
 * - Caution: less than 6 months remaining
 */
export function expiryStatus(expiryDate, asOf = new Date()) {
  if (!expiryDate) return null;
  let exp;
  if (expiryDate instanceof Date) {
    exp = expiryDate;
  } else {
    const s = String(expiryDate).trim();
    const mmmYy = s.match(/^([A-Za-z]{3})-(\d{2})$/);
    if (mmmYy) {
      const months = {
        jan: 0,
        feb: 1,
        mar: 2,
        apr: 3,
        may: 4,
        jun: 5,
        jul: 6,
        aug: 7,
        sep: 8,
        oct: 9,
        nov: 10,
        dec: 11,
      };
      const mi = months[mmmYy[1].toLowerCase()];
      if (mi == null) return null;
      const yy = Number(mmmYy[2]);
      const year = yy < 70 ? 2000 + yy : 1900 + yy;
      exp = new Date(year, mi + 1, 0);
    } else {
      exp = new Date(s);
    }
  }
  if (Number.isNaN(exp.getTime())) return null;

  const today = new Date(asOf);
  today.setHours(0, 0, 0, 0);
  const e = new Date(exp);
  e.setHours(0, 0, 0, 0);

  if (e < today) return 'Expired';

  const monthsLeft =
    (e.getFullYear() - today.getFullYear()) * 12 + (e.getMonth() - today.getMonth());
  if (monthsLeft >= 12) return 'Safe';
  if (monthsLeft >= 6) return 'Critical';
  return 'Caution';
}

function usageQty(row, key) {
  const n = Number(row?.[key]);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseBound(raw) {
  if (!raw || raw === 'all') return null;
  const d = new Date(String(raw).trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function filterRows(rows, query, labelFn = productLabel) {
  const month = String(query.month || 'all').trim();
  const dateFrom = parseBound(query.dateFrom);
  const dateTo = parseBound(query.dateTo);
  const inventoryType = String(query.inventoryType || 'all').trim();
  const hcwId = String(query.hcwId || 'all').trim();

  return rows.filter((row) => {
    const txnDate = parseTxnDate(row);

    if (dateFrom || dateTo) {
      if (!txnDate) return false;
      if (dateFrom && txnDate < startOfDay(dateFrom)) return false;
      if (dateTo && txnDate > endOfDay(dateTo)) return false;
    } else if (month && month !== 'all') {
      const mk = monthKey(txnDate);
      if (mk !== month) return false;
    }

    if (inventoryType && inventoryType !== 'all') {
      const label = labelFn(row);
      if (label.toLowerCase() !== inventoryType.toLowerCase()) return false;
    }
    if (hcwId && hcwId !== 'all') {
      const eid = String(row.empId || row.hcwId || '').trim();
      if (eid !== hcwId) return false;
    }
    return true;
  });
}

/**
 * @param {object[]} ledgerRows In/Out transactions
 * @param {object[]} usageRows Usage tab (screen count = used, wastage)
 * @param {object} query filters
 *
 * Logic:
 * - Inward = all receipts into warehouse
 * - Outward = all issues from warehouse
 * - Balance (warehouse) = Inward − Outward
 * - Used / Wastage = from Usage (camp-linked)
 * - Field Balance = Outward − Used − Wastage (stock still with field)
 * - Safe / Critical / Caution / Expired = Field Balance split by expiry on outward lines
 */
export function buildDashboard(ledgerRows = [], usageRows = [], query = {}) {
  const months = new Set();
  const inventoryTypes = new Set();
  const hcws = new Map();

  for (const row of ledgerRows) {
    const d = parseTxnDate(row);
    const mk = monthKey(d);
    if (mk) months.add(mk);
    const label = productLabel(row);
    if (label && label !== 'Unknown') inventoryTypes.add(label);
    const eid = String(row.empId || '').trim();
    if (eid) {
      hcws.set(eid, String(row.employeeName || row.name || row.recipientName || eid).trim());
    }
  }

  for (const row of usageRows) {
    const d = parseTxnDate(row);
    const mk = monthKey(d);
    if (mk) months.add(mk);
    const label = String(row.inventoryType || row.productName || '').trim();
    if (label) inventoryTypes.add(label);
    const eid = String(row.hcwId || row.empId || '').trim();
    if (eid) {
      hcws.set(eid, String(row.hcwName || row.employeeName || eid).trim());
    }
  }

  const filteredLedger = filterRows(ledgerRows, query);
  const filteredUsage = filterRows(usageRows, query, (row) =>
    String(row.inventoryType || row.productName || '').trim() || 'Unknown'
  );

  let inwardQty = 0;
  let inwardAmount = 0;
  let outwardQty = 0;
  let outwardAmount = 0;
  const expiryBuckets = { Safe: 0, Caution: 0, Critical: 0, Expired: 0 };
  const expiryBucketsAmt = { Safe: 0, Caution: 0, Critical: 0, Expired: 0 };
  const byCity = new Map();
  const byInventoryType = new Map();

  for (const row of filteredLedger) {
    const qty = lineQty(row);
    const amt = lineAmount(row);
    const city = String(row.city || '').trim() || 'Unknown';
    const inv = productLabel(row);

    if (isInwardEntry(row.entryType)) {
      inwardQty += qty;
      inwardAmount += amt;
    }
    if (isOutwardEntry(row.entryType)) {
      outwardQty += qty;
      outwardAmount += amt;

      const cityAgg = byCity.get(city) || { city, qty: 0, amount: 0 };
      cityAgg.qty += qty;
      cityAgg.amount += amt;
      byCity.set(city, cityAgg);

      const invAgg = byInventoryType.get(inv) || { name: inv, qty: 0, amount: 0 };
      invAgg.qty += qty;
      invAgg.amount += amt;
      byInventoryType.set(inv, invAgg);

      const tracking = String(row.trackingType || row.trackingKind || '').toLowerCase();
      const expiryApplicable =
        row.expiryApplicable === true ||
        tracking.includes('expiry') ||
        Boolean(row.expiryDate || row.expDate);
      if (expiryApplicable) {
        const status = expiryStatus(row.expiryDate || row.expDate);
        if (status && expiryBuckets[status] != null) {
          expiryBuckets[status] += qty;
          expiryBucketsAmt[status] += amt;
        }
      }
    }
  }

  let usedQty = 0;
  let usedAmount = 0;
  let wastageQty = 0;
  let wastageAmount = 0;
  for (const row of filteredUsage) {
    const used = usageQty(row, 'screenCount') || usageQty(row, 'usedQty') || usageQty(row, 'used');
    const waste = usageQty(row, 'wastage') || usageQty(row, 'wastageQty');
    const unit = Number(row.perUnitCost) || 0;
    usedQty += used;
    wastageQty += waste;
    usedAmount += used * Math.abs(unit);
    wastageAmount += waste * Math.abs(unit);
  }

  /** Warehouse remaining */
  const balanceQty = inwardQty - outwardQty;
  const balanceAmount = inwardAmount - outwardAmount;

  /**
   * Field stock still with HCWs:
   * Outward − Used − Wastage
   * (When Used/Wastage are 0, Field Balance = Outward.)
   */
  const fieldBalanceQty = Math.max(0, outwardQty - usedQty - wastageQty);
  const fieldBalanceAmount = Math.max(0, outwardAmount - usedAmount - wastageAmount);

  /** Split Field Balance across expiry buckets (scale outward expiry composition) */
  const classifiedQty =
    expiryBuckets.Safe + expiryBuckets.Caution + expiryBuckets.Critical + expiryBuckets.Expired;
  const scaleQty = classifiedQty > 0 ? fieldBalanceQty / classifiedQty : 0;
  const classifiedAmt =
    expiryBucketsAmt.Safe +
    expiryBucketsAmt.Caution +
    expiryBucketsAmt.Critical +
    expiryBucketsAmt.Expired;
  const scaleAmt = classifiedAmt > 0 ? fieldBalanceAmount / classifiedAmt : 0;

  const safeQty = expiryBuckets.Safe * scaleQty;
  const cautionQty = expiryBuckets.Caution * scaleQty;
  const criticalQty = expiryBuckets.Critical * scaleQty;
  const expiredQty = expiryBuckets.Expired * scaleQty;
  const safeAmount = expiryBucketsAmt.Safe * scaleAmt;
  const cautionAmount = expiryBucketsAmt.Caution * scaleAmt;
  const criticalAmount = expiryBucketsAmt.Critical * scaleAmt;
  const expiredAmount = expiryBucketsAmt.Expired * scaleAmt;

  if (!byInventoryType.size) {
    for (const row of filteredLedger) {
      const qty = lineQty(row);
      const amt = lineAmount(row);
      const inv = productLabel(row);
      const invAgg = byInventoryType.get(inv) || { name: inv, qty: 0, amount: 0 };
      invAgg.qty += qty;
      invAgg.amount += amt;
      byInventoryType.set(inv, invAgg);
      const city = String(row.city || '').trim() || 'Unknown';
      const cityAgg = byCity.get(city) || { city, qty: 0, amount: 0 };
      cityAgg.qty += qty;
      cityAgg.amount += amt;
      byCity.set(city, cityAgg);
    }
  }

  return {
    filters: {
      months: [...months].sort().reverse(),
      inventoryTypes: [...inventoryTypes].sort((a, b) => a.localeCompare(b)),
      hcws: [...hcws.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    kpis: {
      inwardQty,
      inwardAmount,
      outwardQty,
      outwardAmount,
      balanceQty,
      balanceAmount,
      usedQty,
      usedAmount,
      wastageQty,
      wastageAmount,
      fieldBalanceQty,
      fieldBalanceAmount,
      safeQty,
      safeAmount,
      cautionQty,
      cautionAmount,
      criticalQty,
      criticalAmount,
      expiredQty,
      expiredAmount,
    },
    logic: {
      balance: 'Inward − Outward (warehouse)',
      fieldBalance: 'Outward − Used − Wastage (still in field)',
      expiry:
        'Field Balance by expiry: Safe 12+ mo · Critical 6–12 mo · Caution <6 mo · Expired',
      used: 'Usage.screenCount (camp-linked)',
      wastage: 'Usage.wastage (camp-linked)',
    },
    byCity: [...byCity.values()].sort((a, b) => b.qty - a.qty),
    byInventoryType: [...byInventoryType.values()].sort((a, b) => b.qty - a.qty),
  };
}
