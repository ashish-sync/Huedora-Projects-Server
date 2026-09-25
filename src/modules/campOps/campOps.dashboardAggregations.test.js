import test from 'node:test';
import assert from 'node:assert/strict';
import {
  campDashboardStatsPipeline,
  formatCampDashboardStats,
  campOperationsBoardPipeline,
  formatOperationsBoardFromGroups,
} from './campOps.dashboardAggregations.js';

test('campDashboardStatsPipeline uses facet groups not document hydrate', () => {
  const pipeline = campDashboardStatsPipeline({ isDeleted: false }, { todayIso: '2024-06-15' });
  assert.equal(pipeline[0].$match.isDeleted, false);
  const facet = pipeline[1].$facet;
  assert.ok(facet.byStatus);
  assert.ok(facet.byClientId);
  assert.ok(facet.overdueApproved);
  assert.ok(facet.offHoursPending);
});

test('formatCampDashboardStats maps group rows to response shape', () => {
  const formatted = formatCampDashboardStats(
    {
      total: [{ n: 5 }],
      byStatus: [{ _id: 'approved', count: 3 }],
      byClientId: [{ _id: 'c1', count: 2 }],
      byCampaignId: [],
      byCampaignName: [],
      byClientName: [{ _id: 'Acme', count: 2 }],
      byState: [{ _id: 'MH', count: 2 }],
      byCampaignType: [],
      monthly: [{ _id: '2024-06', count: 5 }],
      offHoursPending: [{ n: 1 }],
      weekendAttentionPending: [{ n: 0 }],
      overdueApproved: [{ n: 2 }],
    },
    { clients: [{ _id: 'c1', name: 'Acme' }], campaigns: [] },
  );
  assert.equal(formatted.camps.total, 5);
  assert.equal(formatted.camps.byStatus.approved, 3);
  assert.equal(formatted.camps.byStatus.overdue_not_executed, 2);
  assert.equal(formatted.camps.alerts.off_hours_pending, 1);
  assert.equal(formatted.hierarchy.brands.items[0].value, 2);
});

test('operations board pipeline groups by stage and status', () => {
  const pipeline = campOperationsBoardPipeline({ isDeleted: false });
  assert.ok(pipeline.some((s) => s.$group?._id?.stage === '$_boardStage'));
});

test('formatOperationsBoardFromGroups fills stage totals', () => {
  const board = formatOperationsBoardFromGroups([
    { _id: { stage: 'request', status: 'review_pending' }, count: 4 },
    { _id: { stage: 'execution', status: 'planned' }, count: 2 },
  ]);
  assert.equal(board.total, 6);
  const request = board.stages.find((s) => s.id === 'request');
  assert.equal(request.total, 4);
  assert.equal(request.byStatus.review_pending, 4);
});
