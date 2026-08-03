/** HueDora-Connect-compatible camp status machine */

export const CAMP_OPS_STATUSES = [
  'pending_review',
  'approved',
  'rejected',
  'cancelled',
  'executed',
];

export const CAMP_OPS_STATUS_TRANSITIONS = {
  pending_review: ['approved', 'rejected', 'cancelled'],
  approved: ['executed', 'cancelled', 'rejected'],
  rejected: ['pending_review'],
  cancelled: [],
  executed: ['cancelled'],
};

export const CAMP_OPS_SOURCES = [
  'whatsapp',
  'email',
  'excel',
  'dashboard',
  'api',
  'paste',
  'parser',
];

export const CONTACT_PERSON_LEVELS = [
  'Territory Manager',
  'Area Manager',
  'Regional Manager',
  'Zonal Manager',
  'Product Manager',
];

export const CAMP_OPS_CANCEL_SOURCES = ['brand', 'khw'];

export const CAMP_OPS_DURATION_OPTIONS = [3, 4, 5, 6, 8];

export const CAMP_METHOD_OTHER_LABEL = 'Others';

export const CAMP_NAME_OPTIONS = [
  'BMD',
  'Neuro & Physio',
  'Uroflowmetery',
  'Diagnostics',
  'Dietician',
  CAMP_METHOD_OTHER_LABEL,
];

export const DOCTOR_SPECIALTY_OPTIONS = [
  'General Practitioner',
  'Pediatrician',
  'Gynecologist',
  'Cardiologist',
  'Orthopedist',
  'Dermatologist',
  'Neurologist',
  'Urologist',
  'Other (Specify Others)',
];

const LEGACY_CAMP_NAME_ALIASES = {
  dieitician: 'Dietician',
  dietitian: 'Dietician',
  'physio & nuero': 'Neuro & Physio',
  'physio & neuro': 'Neuro & Physio',
  diagnostic: 'Diagnostics',
  diagnostics: 'Diagnostics',
  daignostics: 'Diagnostics',
  uroflow: 'Uroflowmetery',
  uroflowmetry: 'Uroflowmetery',
  uroflowmetery: 'Uroflowmetery',
};

export const EDITABLE_CAMP_STATUSES = ['pending_review', 'approved', 'rejected'];

import { getCampImportFields } from './import/campRequestFieldSchema.js';

export const CAMP_IMPORT_FIELDS = getCampImportFields();

export const STANDARD_IMPORT_MAPPING = Object.fromEntries(
  CAMP_IMPORT_FIELDS.map((f) => [f.key, f.label])
);

/**
 * Role catalog aligned with TYLO One standard roles.
 */
export const CAMP_OPS_ROLE_CATALOG = [
  {
    role: 'Admin',
    label: 'Administrator',
    tyloRole: 'Admin',
    permissions: ['*'],
  },
  {
    role: 'Approver',
    label: 'Approver',
    tyloRole: 'Approver',
    permissions: ['camps:read', 'camps:request', 'camps:approve', 'dashboards:read'],
  },
  {
    role: 'Editor',
    label: 'Editor',
    tyloRole: 'Editor',
    permissions: ['camps:read', 'camps:request', 'imports:execute', 'dashboards:read'],
  },
  {
    role: 'Requester',
    label: 'Requester',
    tyloRole: 'Requester',
    permissions: ['camps:read', 'camps:request'],
  },
  {
    role: 'Viewer',
    label: 'Viewer',
    tyloRole: 'Viewer',
    permissions: ['camps:read', 'dashboards:read'],
  },
];

export function isValidCampName(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  if (trimmed.toLowerCase() === 'others' || trimmed === CAMP_METHOD_OTHER_LABEL) return false;
  if (CAMP_NAME_OPTIONS.includes(trimmed)) return true;
  return trimmed.length >= 2;
}

export function normalizeCampName(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (CAMP_NAME_OPTIONS.includes(trimmed)) return trimmed;

  const lower = trimmed.toLowerCase();
  if (LEGACY_CAMP_NAME_ALIASES[lower]) return LEGACY_CAMP_NAME_ALIASES[lower];

  if (lower.includes('bmd') || lower.includes('classic')) return 'BMD';
  if (lower.includes('diet') || lower.includes('dieit')) return 'Dietician';
  if (lower.includes('physio') || lower.includes('nuero') || lower.includes('neuro')) {
    return 'Neuro & Physio';
  }
  if (lower.includes('diagnostic') || lower.includes('daignostic')) return 'Diagnostics';
  if (lower.includes('uro')) return 'Uroflowmetery';

  return trimmed;
}

export function canTransition(currentStatus, nextStatus) {
  const allowed = CAMP_OPS_STATUS_TRANSITIONS[currentStatus] || [];
  return allowed.includes(nextStatus);
}

export function isCampEditable(status) {
  return EDITABLE_CAMP_STATUSES.includes(status);
}
