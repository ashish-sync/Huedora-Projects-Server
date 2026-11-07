import { CampOpsCamp } from '../campOps/campOps.model.js';
import {
  computeLifecycleDerived,
  isExecutionCancellationForFinance,
  resolvePunctuality,
  campSnapshotPricing,
} from '../campOps/campOps.lifecycle.js';
import { parseLocalDateInput } from '../campOps/campOps.helpers.js';
import { AppError } from '../../utils/helpers.js';

export const CAMP_QUALITY_METRICS = {
  punctuality: {
    id: 'punctuality',
    label: 'Punctuality',
    buckets: ['Yet to Update', 'Cancelled', 'Good', 'Average', 'Poor'],
  },
  attire: {
    id: 'attire',
    label: 'Attire Compliance',
    buckets: ['Yet to Update', 'Cancelled', 'Issue', 'No Issue'],
  },
  chargeability: {
    id: 'chargeability',
    label: 'Chargeability',
    buckets: ['Yet to Update', 'Chargeable', 'Non-Chargeable'],
  },
  campCycle: {
    id: 'campCycle',
    label: 'Avg. Camp Cycle',
    buckets: ['Yet to Update', 'Cancelled', 'Good', 'Average', 'Poor'],
  },
  avgPayout: {
    id: 'avgPayout',
    label: 'Avg. Payout',
    buckets: ['Yet to Update', 'Cancelled', 'Amount'],
  },
};

const CAMP_QUALITY_SELECT = [
  'campDate',
  'executionStatus',
  'status',
  'cancelledBy',
  'assignmentRefusalReason',
  'punctuality',
  'attire',
  'chargeableStatus',
  'startTime',
  'inTime',
  'outTime',
  'totalHours',
  'clientMasterCampDuration',
  'durationHours',
  'campAmount',
  'travelling',
  'overtimeExpense',
  'otherExpenses',
].join(' ');

export function parseCampQualityRange(query = {}) {
  const fromRaw = query.from ? String(query.from).trim() : '';
  const toRaw = query.to ? String(query.to).trim() : '';
  const from = fromRaw ? parseLocalDateInput(fromRaw) : null;
  const to = toRaw ? parseLocalDateInput(toRaw) : null;

  if ((fromRaw && !from) || (toRaw && !to)) {
    throw new AppError('from and to must be YYYY-MM-DD', 400, 'VALIDATION_ERROR');
  }
  if (from && to && from > to) {
    throw new AppError('from must be on or before to', 400, 'VALIDATION_ERROR');
  }
  return { fromRaw: from || '', toRaw: to || '', from, to };
}

export function resolveCampQualityMetric(query = {}) {
  const raw = String(query.metric || 'punctuality').trim();
  const metric = CAMP_QUALITY_METRICS[raw];
  if (!metric) {
    throw new AppError('Unknown camp quality metric', 400, 'VALIDATION_ERROR');
  }
  return metric;
}

function emptyBucketMap(bucketKeys) {
  return Object.fromEntries(bucketKeys.map((key) => [key, 0]));
}

export function classifyAttireBucket(attire) {
  const value = String(attire || '').trim().toLowerCase();
  if (!value) return 'Yet to Update';
  if (value === 'issues' || value === 'issue') return 'Issue';
  if (value === 'no issues' || value === 'no issue') return 'No Issue';
  return 'Yet to Update';
}

export function classifyChargeabilityBucket(chargeableStatus) {
  const value = String(chargeableStatus || '').trim().toLowerCase();
  if (!value) return 'Yet to Update';
  if (value === 'non-chargeable' || value === 'non chargeable') return 'Non-Chargeable';
  if (value === 'chargeable' || value === 'partial') return 'Chargeable';
  return 'Yet to Update';
}

export function classifyPunctualityBucket(camp = {}) {
  if (isExecutionCancellationForFinance(camp)) return 'Cancelled';
  const stored = String(camp.punctuality || '').trim();
  if (stored === 'Good' || stored === 'Average' || stored === 'Poor') return stored;
  const derived = resolvePunctuality(camp.startTime, camp.inTime);
  if (derived === 'Good' || derived === 'Average' || derived === 'Poor') return derived;
  return 'Yet to Update';
}

export function classifyAttireComplianceBucket(camp = {}) {
  if (isExecutionCancellationForFinance(camp)) return 'Cancelled';
  return classifyAttireBucket(camp.attire);
}

export function classifyCampCycleBucket(camp = {}, derived = null) {
  if (isExecutionCancellationForFinance(camp)) return 'Cancelled';
  const lifecycle = derived || computeLifecycleDerived(camp, { pricing: campSnapshotPricing(camp) });
  if (lifecycle.totalHours == null || !Number.isFinite(Number(lifecycle.totalHours))) {
    return 'Yet to Update';
  }
  const extraHours = Number(lifecycle.extraHours) || 0;
  if (extraHours <= 0) return 'Good';
  if (extraHours <= 1) return 'Average';
  return 'Poor';
}

export function classifyAvgPayoutBucket(camp = {}, derived = null) {
  if (isExecutionCancellationForFinance(camp)) return 'Cancelled';
  const lifecycle = derived || computeLifecycleDerived(camp, { pricing: campSnapshotPricing(camp) });
  const totalPayout = Number(lifecycle.totalPayout) || 0;
  if (totalPayout > 0) return 'Amount';
  return 'Yet to Update';
}

export function classifyCampQualityBucket(metricId, camp = {}) {
  const derived = computeLifecycleDerived(camp, { pricing: campSnapshotPricing(camp) });
  switch (metricId) {
    case 'punctuality':
      return { bucket: classifyPunctualityBucket(camp), derived };
    case 'attire':
      return { bucket: classifyAttireComplianceBucket(camp), derived };
    case 'chargeability':
      return { bucket: classifyChargeabilityBucket(camp.chargeableStatus), derived };
    case 'campCycle':
      return { bucket: classifyCampCycleBucket(camp, derived), derived };
    case 'avgPayout':
      return { bucket: classifyAvgPayoutBucket(camp, derived), derived };
    default:
      return { bucket: 'Yet to Update', derived };
  }
}

export function summarizeCampQualityCamps(metric, camps = []) {
  const counts = emptyBucketMap(metric.buckets);
  let amountSum = 0;
  let amountCount = 0;

  for (const camp of camps) {
    const { bucket, derived } = classifyCampQualityBucket(metric.id, camp);
    if (Object.prototype.hasOwnProperty.call(counts, bucket)) {
      counts[bucket] += 1;
    } else {
      counts['Yet to Update'] = (counts['Yet to Update'] || 0) + 1;
    }

    if (metric.id === 'avgPayout' && bucket === 'Amount') {
      const totalPayout = Number(derived?.totalPayout) || 0;
      if (totalPayout > 0) {
        amountSum += totalPayout;
        amountCount += 1;
      }
    }
  }

  const buckets = metric.buckets.map((key) => ({
    key,
    count: counts[key] || 0,
  }));

  const summary = {
    total: camps.length,
  };
  if (metric.id === 'avgPayout') {
    summary.averageAmount = amountCount
      ? Math.round((amountSum / amountCount) * 100) / 100
      : null;
    summary.amountCount = amountCount;
  }

  return {
    metric: metric.id,
    label: metric.label,
    buckets,
    summary,
  };
}

export async function loadCampQualityMetrics({ from, to, metric }) {
  const filter = { isDeleted: false };
  if (from || to) {
    filter.campDate = {};
    if (from) filter.campDate.$gte = from;
    if (to) filter.campDate.$lte = to;
  }

  const camps = await CampOpsCamp.find(filter).select(CAMP_QUALITY_SELECT).lean();
  return {
    from: from || '',
    to: to || '',
    ...summarizeCampQualityCamps(metric, camps),
  };
}
