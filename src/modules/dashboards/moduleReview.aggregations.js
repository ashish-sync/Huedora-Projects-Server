/**
 * Dashboard module-review helpers — filter/group/limit in Mongo, not Node.
 */

import { formatDateTime } from '../../utils/dateFormat.js';

export function reviewLimit(query) {
  return Math.min(Math.max(1, Number(query?.limit) || 200), 500);
}

/** Coalesce first non-null date among fields into `_reviewDate`. */
export function reviewDateExpression(fields) {
  const converters = fields.map((f) => ({
    $convert: { input: `$${f}`, to: 'date', onError: null, onNull: null },
  }));
  return {
    $let: {
      vars: { candidates: converters },
      in: {
        $reduce: {
          input: '$$candidates',
          initialValue: null,
          in: {
            $cond: [{ $eq: ['$$value', null] }, '$$this', '$$value'],
          },
        },
      },
    },
  };
}

export function dateRangeMatch(fromDate, toDate) {
  if (!fromDate && !toDate) return null;
  const range = {};
  if (fromDate) range.$gte = fromDate;
  if (toDate) range.$lte = toDate;
  return { _reviewDate: { $ne: null, ...range } };
}

/**
 * Facet: total + optional status groups + page of projected row docs.
 * @param {object} opts
 * @param {Record<string, unknown>} opts.baseMatch
 * @param {string[]} opts.dateFields
 * @param {Date|null} opts.fromDate
 * @param {Date|null} opts.toDate
 * @param {number} opts.limit
 * @param {Record<string, unknown>} opts.rowProject - $project for page rows
 * @param {string|null} opts.groupField - field for byStatus-style counts
 * @param {Record<string, unknown>|null} opts.sort
 */
export function reviewFacetPipeline({
  baseMatch,
  dateFields,
  fromDate,
  toDate,
  limit,
  rowProject,
  groupField = 'status',
  sort = { _reviewDate: -1 },
}) {
  const stages = [{ $match: baseMatch || { isDeleted: false } }];
  if (dateFields?.length) {
    stages.push({ $addFields: { _reviewDate: reviewDateExpression(dateFields) } });
    const range = dateRangeMatch(fromDate, toDate);
    if (range) stages.push({ $match: range });
  }

  const facet = {
    total: [{ $count: 'n' }],
    rows: [
      ...(sort ? [{ $sort: sort }] : []),
      { $limit: limit },
      { $project: rowProject },
    ],
  };
  if (groupField) {
    facet.byField = [
      {
        $group: {
          _id: { $ifNull: [`$${groupField}`, 'Unknown'] },
          count: { $sum: 1 },
        },
      },
    ];
  }

  stages.push({ $facet: facet });
  return stages;
}

export function facetTotal(bucket) {
  return Number(bucket?.total?.[0]?.n) || 0;
}

export function facetCounts(bucket) {
  const out = {};
  for (const row of bucket?.byField || []) {
    const key = String(row?._id ?? 'Unknown') || 'Unknown';
    out[key] = Number(row.count) || 0;
  }
  return out;
}

export function fmtReviewDate(iso) {
  if (!iso) return '-';
  return formatDateTime(iso);
}
