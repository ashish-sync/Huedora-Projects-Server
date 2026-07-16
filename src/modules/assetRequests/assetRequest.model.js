import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

/** Canonical request types for The Request Center */
export const REQUEST_TYPES = [
  'REPAIR',
  'MAINTENANCE',
  'LOGISTICS',
  'TRAINING',
  'REIMBURSEMENT',
  'OTHER',
];

/** Legacy type still accepted / displayed as Logistics */
export const LEGACY_REQUEST_TYPES = ['MOVEMENT'];

export const ALL_REQUEST_TYPES = [...REQUEST_TYPES, ...LEGACY_REQUEST_TYPES];

export const REQUEST_TYPE_LABELS = {
  REPAIR: 'Repair',
  MAINTENANCE: 'Maintenance',
  LOGISTICS: 'Logistics',
  MOVEMENT: 'Logistics',
  TRAINING: 'Training',
  REIMBURSEMENT: 'Reimbursement',
  OTHER: 'Other',
};

export const REQUEST_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED'];

/** Types that require a linked asset */
export const ASSET_REQUIRED_TYPES = ['REPAIR', 'MAINTENANCE', 'LOGISTICS', 'MOVEMENT'];

export function normalizeRequestType(raw) {
  const t = String(raw || '').toUpperCase();
  if (t === 'MOVEMENT') return 'LOGISTICS';
  return t;
}

export function typeLabel(raw) {
  const t = String(raw || '').toUpperCase();
  return REQUEST_TYPE_LABELS[t] || t;
}

export const AssetRequest = defineCollection('asset_requests', {
  ...softDelete,
  status: 'REQUESTED',
  requestType: 'REPAIR',
});
