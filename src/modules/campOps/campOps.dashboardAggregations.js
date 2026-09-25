/**
 * Camp One dashboard aggregations — Mongo $group instead of full collection scans.
 */

import { CAMP_OPS_STATUSES } from './campOps.constants.js';
import {
  createOperationsBoardState,
  finalizeOperationsBoard,
  OPERATIONS_BOARD_STAGES,
} from './campOps.operationsBoard.js';

function groupRowsToMap(rows = []) {
  const map = new Map();
  for (const row of rows) {
    if (row?._id == null || row._id === '') continue;
    map.set(String(row._id), Number(row.count) || 0);
  }
  return map;
}

/** Stats KPI facet pipeline for camp_ops_camps. */
export function campDashboardStatsPipeline(filter = {}, { todayIso = '' } = {}) {
  const today = String(todayIso || new Date().toISOString().slice(0, 10));
  return [
    { $match: filter },
    {
      $facet: {
        total: [{ $count: 'n' }],
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        byClientId: [{ $group: { _id: '$clientId', count: { $sum: 1 } } }],
        byCampaignId: [{ $group: { _id: '$campaignId', count: { $sum: 1 } } }],
        byCampaignName: [{ $group: { _id: '$campaignName', count: { $sum: 1 } } }],
        byClientName: [{ $group: { _id: '$clientName', count: { $sum: 1 } } }],
        byState: [
          { $match: { state: { $nin: [null, ''] } } },
          { $group: { _id: '$state', count: { $sum: 1 } } },
        ],
        byCampaignType: [{ $group: { _id: '$campaignType', count: { $sum: 1 } } }],
        monthly: [
          {
            $addFields: {
              _month: {
                $cond: [
                  { $and: [{ $ne: ['$campDate', null] }, { $ne: ['$campDate', ''] }] },
                  { $substrBytes: [{ $toString: '$campDate' }, 0, 7] },
                  null,
                ],
              },
            },
          },
          { $match: { _month: { $nin: [null, ''] } } },
          { $group: { _id: '$_month', count: { $sum: 1 } } },
        ],
        offHoursPending: [
          {
            $match: {
              status: 'pending_review',
              submittedOffHours: true,
            },
          },
          { $count: 'n' },
        ],
        weekendAttentionPending: [
          {
            $match: {
              status: 'pending_review',
              submittedWeekendAttention: true,
            },
          },
          { $count: 'n' },
        ],
        /** Approved camps on/before today — KPI proxy for overdue_not_executed. */
        overdueApproved: [
          {
            $match: {
              status: 'approved',
              campDate: { $nin: [null, ''] },
            },
          },
          {
            $addFields: {
              _campDay: {
                $substrBytes: [{ $toString: '$campDate' }, 0, 10],
              },
            },
          },
          {
            $match: {
              _campDay: { $lte: today },
            },
          },
          { $count: 'n' },
        ],
      },
    },
  ];
}

export function formatCampDashboardStats(bucket = {}, { clients = [], campaigns = [] } = {}) {
  const byStatus = Object.fromEntries(CAMP_OPS_STATUSES.map((s) => [s, 0]));
  for (const row of bucket.byStatus || []) {
    if (row?._id) byStatus[row._id] = Number(row.count) || 0;
  }
  const brandCounts = groupRowsToMap(bucket.byClientId);
  const campaignCounts = groupRowsToMap(bucket.byCampaignId);
  const campaignNameCounts = groupRowsToMap(bucket.byCampaignName);
  const clientNameCounts = groupRowsToMap(bucket.byClientName);
  const stateCounts = groupRowsToMap(bucket.byState);
  const campaignTypeCounts = groupRowsToMap(bucket.byCampaignType);
  const monthlyMap = groupRowsToMap(bucket.monthly);

  const brandBreakdown = clients
    .map((brand) => ({
      id: brand._id,
      label: brand.name,
      value: brandCounts.get(String(brand._id)) || 0,
    }))
    .filter((item) => item.value > 0);

  const campaignBreakdown = campaigns
    .map((item) => ({
      id: item._id,
      label: `${item.clientName || 'Brand'} — ${item.division || item.name}`,
      division: item.division || item.name,
      value:
        (campaignCounts.get(String(item._id)) || 0)
        + (campaignNameCounts.get(String(item.name)) || 0),
    }))
    .filter((entry) => entry.value > 0);

  const topFromMap = (map, n = 10) =>
    [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, n);

  const total = Number(bucket.total?.[0]?.n) || 0;
  const overdueNotExecuted = Number(bucket.overdueApproved?.[0]?.n) || 0;
  const offHoursPending = Number(bucket.offHoursPending?.[0]?.n) || 0;
  const weekendAttentionPending = Number(bucket.weekendAttentionPending?.[0]?.n) || 0;

  return {
    hierarchy: {
      brands: { total: clients.length, items: brandBreakdown },
      campaigns: { total: campaigns.length, items: campaignBreakdown },
    },
    camps: {
      total,
      byStatus: {
        ...byStatus,
        overdue_not_executed: overdueNotExecuted,
      },
      alerts: {
        reaction_required: 0,
        off_hours_pending: offHoursPending,
        weekend_attention_pending: weekendAttentionPending,
      },
    },
    charts: {
      byClient: topFromMap(clientNameCounts, 10),
      byState: topFromMap(stateCounts, 10),
      byCampaignType: topFromMap(campaignTypeCounts, 50),
      monthlyTrends: [...monthlyMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, value]) => ({ label, value })),
    },
  };
}

/**
 * Operations board: group by derived stage + status in Mongo (no per-camp hydrate).
 * Uses stored lifecycle / review / payment fields (same vocabulary as Manage filters).
 */
export function campOperationsBoardPipeline(filter = {}) {
  return [
    { $match: filter },
    {
      $addFields: {
        _cancelledByTylo: {
          $and: [
            { $eq: ['$status', 'cancelled'] },
            {
              $or: [
                { $in: ['$assignmentRefusalReason', ['Cancelled by Tylo', 'Cancelled by TCPL']] },
                { $eq: ['$executionStatus', 'Cancelled by Tylo'] },
                { $eq: ['$cancelledBy', 'khw'] },
              ],
            },
          ],
        },
        _cancelledByClient: {
          $and: [
            { $eq: ['$status', 'cancelled'] },
            {
              $or: [
                { $eq: ['$assignmentRefusalReason', 'Cancelled by Client'] },
                { $eq: ['$executionStatus', 'Cancelled by Client'] },
                { $eq: ['$cancelledBy', 'brand'] },
              ],
            },
          ],
        },
        _lifecycle: {
          $toLower: { $ifNull: ['$lifecycleStage', 'request'] },
        },
      },
    },
    {
      $addFields: {
        _boardStage: {
          $cond: [
            { $or: ['$_cancelledByTylo', '$_cancelledByClient'] },
            'execution',
            {
              $cond: [
                { $in: ['$_lifecycle', ['request', 'assignment', 'execution', 'financial']] },
                '$_lifecycle',
                'request',
              ],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        _boardStatus: {
          $switch: {
            branches: [
              {
                case: { $eq: ['$_boardStage', 'request'] },
                then: {
                  $let: {
                    vars: {
                      rrs: { $ifNull: ['$requestReviewStatus', ''] },
                      st: { $ifNull: ['$status', ''] },
                    },
                    in: {
                      $switch: {
                        branches: [
                          { case: { $eq: ['$$rrs', 'request_rejected'] }, then: 'request_rejected' },
                          {
                            case: { $eq: ['$$rrs', 'information_requested'] },
                            then: 'information_requested',
                          },
                          { case: { $eq: ['$$rrs', 'review_overdue'] }, then: 'review_overdue' },
                          {
                            case: {
                              $or: [
                                { $eq: ['$$rrs', 'review_pending'] },
                                { $eq: ['$$st', 'pending_review'] },
                              ],
                            },
                            then: 'review_pending',
                          },
                        ],
                        default: '',
                      },
                    },
                  },
                },
              },
              {
                case: { $eq: ['$_boardStage', 'assignment'] },
                then: {
                  $cond: [
                    { $eq: [{ $ifNull: ['$assignmentStatus', ''] }, 'Hiring Requested'] },
                    'hiring_requested',
                    'unassigned',
                  ],
                },
              },
              {
                case: { $eq: ['$_boardStage', 'execution'] },
                then: {
                  $cond: [
                    '$_cancelledByTylo',
                    'cancelled_by_tylo',
                    {
                      $cond: [
                        '$_cancelledByClient',
                        'cancelled_by_client',
                        {
                          $cond: [
                            {
                              $in: [
                                { $ifNull: ['$effectiveExecutionStatus', '$executionStatus'] },
                                ['Marked Executed', 'Camp Completed', 'executed', 'camp_completed'],
                              ],
                            },
                            'executed',
                            'planned',
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
              {
                case: { $eq: ['$_boardStage', 'financial'] },
                then: {
                  $cond: [
                    { $eq: [{ $ifNull: ['$financePaymentStatus', ''] }, 'paid'] },
                    'payment_done',
                    {
                      $switch: {
                        branches: [
                          {
                            case: { $eq: ['$paymentSubmitStatus', 'payment_hold'] },
                            then: 'payment_hold',
                          },
                          {
                            case: { $eq: ['$paymentSubmitStatus', 'payment_confirmed'] },
                            then: 'payment_confirmed',
                          },
                        ],
                        default: 'payment_not_checked',
                      },
                    },
                  ],
                },
              },
            ],
            default: '',
          },
        },
      },
    },
    {
      $group: {
        _id: { stage: '$_boardStage', status: '$_boardStatus' },
        count: { $sum: 1 },
      },
    },
  ];
}

export function formatOperationsBoardFromGroups(rows = [], now = new Date()) {
  const state = createOperationsBoardState(now);
  for (const row of rows) {
    const stageId = row?._id?.stage;
    const statusValue = row?._id?.status;
    const count = Number(row.count) || 0;
    if (!stageId || !count) continue;
    state.total += count;
    const stage = state.stageMap[stageId];
    if (!stage) continue;
    stage.total += count;
    if (statusValue && Object.prototype.hasOwnProperty.call(stage.byStatus, statusValue)) {
      stage.byStatus[statusValue] += count;
    }
  }
  return finalizeOperationsBoard(state);
}

export { OPERATIONS_BOARD_STAGES };
