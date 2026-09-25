/**
 * Dashboard aggregation helpers — keep reads off full-collection hydrates.
 */

import {
  ASSET_STATUS_OPTIONS,
  VERIFICATION_ONE_ELIGIBLE_STATUSES,
} from '../devices/device.constants.js';

/** Sum + status counts for finance_expenses via aggregation (Mongo) or in-memory fallback. */
export function expenseOverviewPipeline() {
  return [
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        total: { $sum: { $ifNull: ['$amount', 0] } },
        open: {
          $sum: {
            $cond: [
              { $in: ['$status', ['Draft', 'Submitted', 'Approved']] },
              1,
              0,
            ],
          },
        },
      },
    },
  ];
}

export function invoiceOverviewPipeline() {
  return [
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        total: { $sum: { $ifNull: ['$totalAmount', 0] } },
        open: {
          $sum: {
            $cond: [
              { $in: ['$status', ['Open', 'Partially paid']] },
              1,
              0,
            ],
          },
        },
      },
    },
  ];
}

export function commercialDocOverviewPipeline(documentTypes) {
  return [
    {
      $match: {
        isDeleted: false,
        documentType: Array.isArray(documentTypes)
          ? { $in: documentTypes }
          : documentTypes,
      },
    },
    {
      $group: {
        _id: { documentType: '$documentType', status: '$status' },
        count: { $sum: 1 },
        grandTotal: { $sum: { $ifNull: ['$grandTotal', 0] } },
      },
    },
  ];
}

/**
 * Normalize commercial aggregate rows into overview KPI fields.
 */
export function summarizeCommercialAggregates(rows = []) {
  let proformaDraft = 0;
  let proformaCount = 0;
  let poDraft = 0;
  let purchaseOrderCount = 0;
  let commercialDraft = 0;
  let commercialSubmitted = 0;
  let clientInvoiceTotal = 0;
  let clientInvoiceCount = 0;

  for (const row of rows) {
    const type = row?._id?.documentType || '';
    const status = row?._id?.status || '';
    const count = Number(row.count) || 0;
    const grandTotal = Number(row.grandTotal) || 0;

    if (type === 'proforma') {
      proformaCount += count;
      if (status === 'Draft' || status === 'Uploaded') proformaDraft += count;
    }
    if (type === 'purchase_order') {
      purchaseOrderCount += count;
      if (status === 'Draft' || status === 'Uploaded') poDraft += count;
    }
    if (
      (type === 'client_invoice' || type === 'credit_note')
      && ['Draft', 'Uploaded', 'Submitted', 'Approved'].includes(status)
    ) {
      commercialDraft += count;
    }
    if (['proforma', 'purchase_order', 'client_invoice', 'credit_note'].includes(type)
      && status === 'Submitted') {
      commercialSubmitted += count;
    }
    if (type === 'client_invoice') {
      clientInvoiceTotal += grandTotal;
      clientInvoiceCount += count;
    }
  }

  return {
    proformaDraft,
    proformaCount,
    poDraft,
    purchaseOrderCount,
    commercialDraft,
    commercialSubmitted,
    clientInvoiceTotal,
    clientInvoiceCount,
  };
}

/** First aggregate row or empty defaults. */
export function firstGroupRow(rows, defaults = { total: 0, open: 0, count: 0 }) {
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  return {
    total: Number(row?.total) || defaults.total || 0,
    open: Number(row?.open) || defaults.open || 0,
    count: Number(row?.count) || defaults.count || 0,
  };
}

/**
 * Onboard date mirrors JS tracking logic:
 * purchaseDate → addedMonth (MM/YYYY → 1st of month) → createdAt.
 */
export function assetOnboardDateExpression() {
  return {
    $let: {
      vars: {
        purchase: {
          $convert: {
            input: '$purchaseDate',
            to: 'date',
            onError: null,
            onNull: null,
          },
        },
        added: { $ifNull: ['$addedMonth', ''] },
        created: {
          $convert: {
            input: '$createdAt',
            to: 'date',
            onError: null,
            onNull: null,
          },
        },
      },
      in: {
        $cond: [
          { $ne: ['$$purchase', null] },
          '$$purchase',
          {
            $cond: [
              {
                $regexMatch: {
                  input: '$$added',
                  regex: '^(0[1-9]|1[0-2])/[0-9]{4}$',
                },
              },
              {
                $let: {
                  vars: {
                    parts: { $split: ['$$added', '/'] },
                  },
                  in: {
                    $dateFromParts: {
                      year: { $toInt: { $arrayElemAt: ['$$parts', 1] } },
                      month: { $toInt: { $arrayElemAt: ['$$parts', 0] } },
                      day: 1,
                    },
                  },
                },
              },
              '$$created',
            ],
          },
        ],
      },
    },
  };
}

/** Normalize agreementStatus the same way the tracking board does. */
export function trackingStatusExpression() {
  return {
    $let: {
      vars: {
        raw: { $trim: { input: { $ifNull: ['$agreementStatus', ''] } } },
      },
      in: {
        $switch: {
          branches: [
            {
              case: { $eq: [{ $toLower: '$$raw' }, 'active'] },
              then: 'Agreement Signed',
            },
            {
              case: { $in: ['$$raw', ASSET_STATUS_OPTIONS] },
              then: '$$raw',
            },
            {
              case: { $eq: ['$$raw', ''] },
              then: 'Not Initiated',
            },
          ],
          default: {
            $cond: [{ $eq: ['$$raw', ''] }, 'Not Initiated', '$$raw'],
          },
        },
      },
    },
  };
}

/**
 * Stages: compute onboardDate (+ optional range filter).
 * When from/to unset, only computes the field (no filter).
 */
export function trackingOnboardDateStages(fromDate, toDate) {
  const stages = [
    { $match: { isDeleted: false } },
    { $addFields: { _onboardDate: assetOnboardDateExpression() } },
  ];
  if (fromDate || toDate) {
    const range = {};
    if (fromDate) range.$gte = fromDate;
    if (toDate) range.$lte = toDate;
    stages.push({
      $match: {
        _onboardDate: { $ne: null, ...range },
      },
    });
  }
  return stages;
}

/**
 * Inventory by agreement status — qty + value only (no full docs).
 */
export function trackingInventoryByStatusPipeline(fromDate, toDate) {
  return [
    ...trackingOnboardDateStages(fromDate, toDate),
    {
      $addFields: {
        _status: trackingStatusExpression(),
        _value: {
          $let: {
            vars: {
              n: {
                $convert: {
                  input: '$deviceValue',
                  to: 'double',
                  onError: 0,
                  onNull: 0,
                },
              },
            },
            in: {
              $cond: [
                { $and: [{ $ne: ['$$n', null] }, { $gte: ['$$n', 0] }] },
                '$$n',
                0,
              ],
            },
          },
        },
      },
    },
    {
      $group: {
        _id: '$_status',
        qty: { $sum: 1 },
        value: { $sum: '$_value' },
      },
    },
  ];
}

/**
 * Lean projection of Verification One–eligible assets for condition bucketing.
 */
export function trackingEligibleAssetsPipeline(fromDate, toDate) {
  return [
    ...trackingOnboardDateStages(fromDate, toDate),
    {
      $addFields: {
        _status: trackingStatusExpression(),
        _productType: { $trim: { input: { $ifNull: ['$productType', ''] } } },
      },
    },
    {
      $match: {
        $and: [
          {
            $or: [
              { _productType: '' },
              { _productType: 'Medical Device' },
            ],
          },
          { _status: { $in: VERIFICATION_ONE_ELIGIBLE_STATUSES } },
        ],
      },
    },
    {
      $project: {
        _id: 1,
        agreementStatus: 1,
        deviceValue: 1,
        productType: 1,
        lastVerifiedAt: 1,
        serialNumber: 1,
        deviceNameSnapshot: 1,
      },
    },
  ];
}

/**
 * Build a lean Mongo match for asset onboard date when from/to are set.
 * Prefer trackingOnboardDateStages for full addedMonth fidelity.
 */
export function assetOnboardDateMatch(fromDate, toDate) {
  if (!fromDate && !toDate) return { isDeleted: false };
  const range = {};
  if (fromDate) range.$gte = fromDate;
  if (toDate) range.$lte = toDate;
  return {
    isDeleted: false,
    $or: [
      { purchaseDate: range },
      { createdAt: range },
    ],
  };
}

/** Map $group status rows into ordered inventory buckets. */
export function formatTrackingInventoryBuckets(rows = [], statusOptions = ASSET_STATUS_OPTIONS) {
  const statusBuckets = Object.fromEntries(
    statusOptions.map((status) => [status, { status, qty: 0, value: 0 }]),
  );
  let inventoryQty = 0;
  let inventoryValue = 0;

  for (const row of rows) {
    const status = row?._id || 'Not Initiated';
    const qty = Number(row.qty) || 0;
    const value = Number(row.value) || 0;
    inventoryQty += qty;
    inventoryValue += value;
    if (!statusBuckets[status]) {
      statusBuckets[status] = { status, qty: 0, value: 0 };
    }
    statusBuckets[status].qty += qty;
    statusBuckets[status].value += value;
  }

  const assetStatus = [
    ...statusOptions.map((status) => statusBuckets[status]),
    ...Object.values(statusBuckets).filter((b) => !statusOptions.includes(b.status)),
  ];

  return { inventoryQty, inventoryValue, assetStatus };
}

export function assetValueOf(a) {
  const n = Number(a?.deviceValue);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
