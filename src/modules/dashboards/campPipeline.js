import { CampOpsCamp } from '../campOps/campOps.model.js';
import { buildCampFilter } from '../campOps/campOps.helpers.js';
import { applyAssignedUserCampFilter } from '../campOps/clientMaster.programScope.js';
import {
  campOperationsBoardPipeline,
  formatOperationsBoardFromGroups,
} from '../campOps/campOps.dashboardAggregations.js';
import {
  createOperationsBoardState,
  addCampToOperationsBoard,
  finalizeOperationsBoard,
} from '../campOps/campOps.operationsBoard.js';

export const PIPELINE_ADMIN_SYSTEM_ROLES = new Set(['Admin', 'Super Admin']);

export function canUsePipelineAdminFilters(user) {
  return PIPELINE_ADMIN_SYSTEM_ROLES.has(String(user?.systemRole || '').trim());
}

/** Build camp match filter for homepage Camp Pipeline (date for all; method/user for admins). */
export async function buildCampPipelineFilter(query = {}, user = null) {
  const allowAdminFilters = canUsePipelineAdminFilters(user);
  const dateFrom = String(query.dateFrom || query.from || '').trim();
  const dateTo = String(query.dateTo || query.to || '').trim();
  const campaign = allowAdminFilters
    ? String(query.campaign || query.campaignName || query.method || '').trim()
    : '';
  const assignedUser = allowAdminFilters
    ? String(query.assignedUser || query.assignedUserEmail || '').trim()
    : '';

  let filter = buildCampFilter({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    campaign: campaign || undefined,
  });
  filter = await applyAssignedUserCampFilter(filter, {
    assignedUser: assignedUser || undefined,
    campaign: campaign || undefined,
  });
  return {
    filter,
    applied: {
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      campaign: campaign || null,
      assignedUser: assignedUser || null,
      adminFilters: allowAdminFilters,
    },
  };
}

export async function loadCampPipelineBoard(query = {}, user = null) {
  const { filter, applied } = await buildCampPipelineFilter(query, user);
  const now = new Date();
  const { getPersistenceMode, aggregateCollection } = await import('../../store/persistence.js');

  let board;
  if (getPersistenceMode() === 'mongo') {
    const groups = await aggregateCollection(
      'camp_ops_camps',
      campOperationsBoardPipeline(filter, { now })
    );
    board = formatOperationsBoardFromGroups(groups || [], now);
  } else {
    const { scanCollection } = await import('../../store/filedb.js');
    const state = createOperationsBoardState(now);
    await scanCollection('camp_ops_camps', {
      filter,
      projection: {
        status: 1,
        lifecycleStage: 1,
        assignmentStatus: 1,
        assignmentDecision: 1,
        executionStatus: 1,
        effectiveExecutionStatus: 1,
        financePaymentStatus: 1,
        paymentSubmitStatus: 1,
        cancellationSource: 1,
        cancelledBy: 1,
        assignmentRefusalReason: 1,
        campDate: 1,
        startTime: 1,
        endTime: 1,
        submittedAt: 1,
        requestReviewStatus: 1,
        requestIncomplete: 1,
        isDeleted: 1,
      },
      forEach: (camp) => {
        addCampToOperationsBoard(state, camp);
      },
    });
    board = finalizeOperationsBoard(state);
  }

  return {
    ...board,
    filters: applied,
  };
}

/** Lightweight status map for tests / fallback consumers. */
export async function loadCampPipelineStatusCounts(query = {}, user = null) {
  const { filter, applied } = await buildCampPipelineFilter(query, user);
  const rows = await CampOpsCamp.aggregate([
    { $match: filter },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  return {
    campsByStatus: Object.fromEntries((rows || []).map((row) => [row._id || 'Unknown', row.count])),
    filters: applied,
  };
}
