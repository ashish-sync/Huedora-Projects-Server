import { applyRequestReviewTransition } from './campOps.requestReview.js';

export const CAMP_CLOSURE_TYPES = [
  'Cancelled by Client',
  'Refused',
  'Cancelled by Tylo',
];

export const CAMP_CLOSURE_TAXONOMY = {
  'Cancelled by Client': {
    'Client Decision': [
      { value: 'client_cancelled', label: 'Client Cancelled' },
      { value: 'client_rescheduled', label: 'Client Rescheduled' },
    ],
  },
  Refused: {
    'Request Issue': [
      { value: 'other_request_issues', label: 'Other Request Issues' },
      { value: 'duplicate_request', label: 'Duplicate Request' },
      { value: 'delayed_confirmation', label: 'Delayed Confirmation' },
      { value: 'short_notice', label: 'Short Notice' },
      { value: 'non_serviceable_hq', label: 'Non Serviceable HQ' },
    ],
  },
  'Cancelled by Tylo': {
    'Resource Issue': [
      { value: 'hcw_unavailability', label: 'HCW Unavailability' },
      { value: 'hcw_backout', label: 'HCW Backout' },
    ],
    'Operational Issue': [
      { value: 'punctuality', label: 'Punctuality' },
      { value: 'compliance_knowledge', label: 'Compliance & Knowledge' },
      { value: 'grooming_issue', label: 'Grooming Issue' },
    ],
    'Device & Inventory': [
      { value: 'device_failure', label: 'Device Failure' },
      { value: 'inventory_shortage', label: 'Inventory Shortage' },
      { value: 'missing_consumables', label: 'Missing Consumables' },
    ],
    'External Factors': [
      { value: 'adverse_weather', label: 'Adverse Weather' },
      { value: 'force_majeure', label: 'Force Majeure' },
    ],
    Other: [
      { value: 'other_mandatory_remarks', label: 'Other (Mandatory Remarks)' },
    ],
  },
};

const LEGACY_REFUSAL_ALIASES = {
  Rejected: 'Refused',
  'Cancelled by TCPL': 'Cancelled by Tylo',
};

const LEGACY_REASON_CODES = {
  1: 'client_cancelled',
  2: 'duplicate_request',
  3: 'hcw_unavailability',
  4: 'device_failure',
  5: 'other_mandatory_remarks',
};

export function normalizeClosureType(value = '') {
  const raw = String(value || '').trim();
  return LEGACY_REFUSAL_ALIASES[raw] || raw;
}

export function isCampHcwAssigned(camp = {}) {
  if (camp.assignmentStatus === 'Assigned') return true;
  if (camp.hcwContactId) return true;
  if (camp.assignmentDecision === 'assign' && (camp.hcwName || camp.hcwContact)) return true;
  if (camp.lifecycleStage === 'execution' && camp.assignmentDecision === 'assign') return true;
  return false;
}

export function getAvailableClosureTypes(camp = {}) {
  const stage = String(camp.lifecycleStage || 'request').trim();

  if (stage === 'financial') return [];

  if (stage === 'execution') {
    return ['Cancelled by Tylo', 'Cancelled by Client'];
  }

  if (stage === 'assignment') {
    return ['Refused', 'Cancelled by Tylo', 'Cancelled by Client'];
  }

  return ['Refused'];
}

export function getClosureReasonCategories(closureType, camp = {}) {
  const normalizedType = normalizeClosureType(closureType);
  const allowedTypes = camp ? getAvailableClosureTypes(camp) : CAMP_CLOSURE_TYPES;
  if (!allowedTypes.includes(normalizedType)) return [];
  const tree = CAMP_CLOSURE_TAXONOMY[normalizedType];
  return tree ? Object.keys(tree) : [];
}

export function hasSingleClosureReasonCategory(closureType, camp = {}) {
  return getClosureReasonCategories(closureType, camp).length === 1;
}

export function resolveClosureReasonCategory(closureType, reasonCategory = '', camp = {}) {
  const categories = getClosureReasonCategories(closureType, camp);
  const selected = String(reasonCategory || '').trim();
  if (selected && categories.includes(selected)) return selected;
  if (categories.length === 1) return categories[0];
  return '';
}

export function getClosureSubReasons(closureType, reasonCategory) {
  const tree = CAMP_CLOSURE_TAXONOMY[normalizeClosureType(closureType)];
  if (!tree || !reasonCategory) return [];
  return tree[reasonCategory] || [];
}

export function findClosureSubReason(closureType, reasonCategory, subReasonValue) {
  return getClosureSubReasons(closureType, reasonCategory)
    .find((item) => item.value === subReasonValue) || null;
}

export function closureSubReasonRequiresRemarks(subReasonValue) {
  return subReasonValue === 'other_mandatory_remarks';
}

export function normalizeClosureSubReason(value = '') {
  const raw = String(value || '').trim();
  if (LEGACY_REASON_CODES[raw]) return LEGACY_REASON_CODES[raw];
  return raw;
}

export function resolveClosureSelection({
  closureType,
  reasonCategory,
  subReason,
  reasonCode,
  closureReasonCode,
  camp,
} = {}) {
  const normalizedType = normalizeClosureType(closureType);
  const category = resolveClosureReasonCategory(normalizedType, reasonCategory, camp);
  const rawSubReason = normalizeClosureSubReason(subReason || reasonCode || closureReasonCode);
  const allowedTypes = camp ? getAvailableClosureTypes(camp) : CAMP_CLOSURE_TYPES;

  if (!allowedTypes.includes(normalizedType)) {
    const stage = String(camp?.lifecycleStage || 'request').trim();
    if (stage === 'execution') {
      throw new Error('At execution stage, only Cancelled by Tylo or Cancelled by Client is allowed');
    }
    if (stage === 'assignment') {
      throw new Error('Choose Refused, Cancelled by Tylo, or Cancelled by Client');
    }
    throw new Error('Only Refused is allowed at the request stage');
  }
  if (!category) {
    throw new Error('Select a reason');
  }
  const subReasonMeta = findClosureSubReason(normalizedType, category, rawSubReason);
  if (!subReasonMeta) {
    throw new Error('Select a sub-reason');
  }

  return {
    closureType: normalizedType,
    reasonCategory: category,
    subReason: subReasonMeta.value,
    subReasonLabel: subReasonMeta.label,
  };
}

export function buildClosureRemark({
  closureType,
  reasonCategory,
  subReasonLabel,
  closureRemarks = '',
} = {}) {
  const parts = [closureType, reasonCategory, subReasonLabel].filter(Boolean);
  const base = parts.join(' · ');
  const remarks = String(closureRemarks || '').trim();
  return remarks ? `${base} — ${remarks}` : base;
}

export function canCloseCampStatus(status) {
  return !['cancelled', 'rejected'].includes(String(status || '').trim());
}

export function canCloseCampRecord(camp = {}) {
  if (!canCloseCampStatus(camp?.status)) return false;
  if (String(camp?.lifecycleStage || '').trim() === 'financial') return false;
  return true;
}

export function applyCampClosure(camp, {
  closureType,
  reasonCategory,
  subReason,
  reasonCode,
  closureReasonCode,
  closureRemarks = '',
  actor,
} = {}) {
  const resolved = resolveClosureSelection({
    closureType,
    reasonCategory,
    subReason,
    reasonCode,
    closureReasonCode,
    camp,
  });

  if (closureSubReasonRequiresRemarks(resolved.subReason) && !String(closureRemarks || '').trim()) {
    throw new Error('Remarks are required for this sub-reason');
  }
  if (!canCloseCampStatus(camp.status)) {
    throw new Error('Camp is already closed');
  }

  const remark = buildClosureRemark({
    closureType: resolved.closureType,
    reasonCategory: resolved.reasonCategory,
    subReasonLabel: resolved.subReasonLabel,
    closureRemarks,
  });

  camp.closureReasonCategory = resolved.reasonCategory;
  camp.closureSubReason = resolved.subReason;
  camp.closureSubReasonLabel = resolved.subReasonLabel;
  camp.closureReasonCode = resolved.subReason;
  camp.cancellationReason = remark;
  camp.assignmentRefusalReason = resolved.closureType;
  camp.assignmentDecision = 'refuse';
  camp.assignmentStatus = 'Unassigned';
  camp.hcwContactId = null;
  camp.hcwCategory = '';
  camp.hcwName = '';
  camp.hcwContact = '';
  camp.remarks = remark;

  if (resolved.closureType === 'Refused') {
    const wasPendingReview = camp.status === 'pending_review';
    camp.status = 'rejected';
    camp.rejectionReason = remark;
    if (wasPendingReview) {
      applyRequestReviewTransition(camp, 'reject', { reason: remark, actor });
    }
    return;
  }

  camp.status = 'cancelled';
  camp.cancelledBy = resolved.closureType === 'Cancelled by Client' ? 'brand' : 'khw';
}
