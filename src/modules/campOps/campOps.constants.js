/** HueDora-Connect-compatible camp status machine */

export const CAMP_OPS_STATUSES = [
  'pending_review',
  'approved',
  'rejected',
  'cancelled',
  'executed',
];

export const CAMP_OPS_STATUS_TRANSITIONS = {
  pending_review: ['approved', 'rejected'],
  approved: ['executed', 'cancelled'],
  rejected: ['pending_review'],
  cancelled: [],
  executed: [],
};

export const CAMP_OPS_SOURCES = ['whatsapp', 'email', 'excel', 'dashboard', 'api', 'paste'];

export const CAMP_OPS_CANCEL_SOURCES = ['brand', 'khw'];

export const CAMP_OPS_DURATION_OPTIONS = [3, 4, 5, 6, 8];

export const CAMP_NAME_OPTIONS = ['BMD', 'Dieitician', 'Others', 'Physio & Nuero', 'Uroflow'];

export const EDITABLE_CAMP_STATUSES = ['pending_review', 'approved', 'rejected'];

export const CAMP_IMPORT_FIELDS = [
  { key: 'clientName', label: 'Client Name', required: true },
  { key: 'campaignType', label: 'Division / Therapy', required: false },
  { key: 'campaignName', label: 'Camp Name', required: false },
  { key: 'doctorName', label: 'Doctor Name', required: false },
  { key: 'doctorCode', label: 'Doctor Code', required: false },
  { key: 'campAddress', label: 'Camp Address', required: false },
  { key: 'city', label: 'City', required: false },
  { key: 'state', label: 'State', required: false },
  { key: 'pincode', label: 'Pincode', required: false },
  { key: 'campDate', label: 'Camp Date', required: true },
  { key: 'startTime', label: 'Start Time', required: false },
  { key: 'endTime', label: 'End Time', required: false },
  { key: 'expectedPatients', label: 'Expected Patients', required: false },
  { key: 'fieldPersonName', label: 'Field Person Name', required: false },
  { key: 'fieldPersonPhone', label: 'Field Person Contact', required: false },
  { key: 'remarks', label: 'Remarks', required: false },
];

export const STANDARD_IMPORT_MAPPING = Object.fromEntries(
  CAMP_IMPORT_FIELDS.map((f) => [f.key, f.label])
);

/**
 * Role catalog aligned with TYLO One ROLE_PERMISSIONS (not HueDora's separate role enum).
 * HueDora mapping for reference:
 *   super_admin / admin → Admin (*)
 *   operations_executive → CampRequester / AssetManager (camps:read + camps:request)
 *   reviewer → CampApprover / Approver (camps:read + camps:approve)
 *   read_only → Viewer (camps:read; Viewer also has camps:request in TYLO)
 */
export const CAMP_OPS_ROLE_CATALOG = [
  {
    role: 'Admin',
    label: 'Administrator',
    tyloRole: 'Admin',
    huedoraEquivalent: 'admin / super_admin',
    permissions: ['*'],
  },
  {
    role: 'CampApprover',
    label: 'Camp Approver',
    tyloRole: 'CampApprover',
    huedoraEquivalent: 'reviewer',
    permissions: ['camps:read', 'camps:request', 'camps:approve', 'dashboards:read'],
  },
  {
    role: 'Approver',
    label: 'Approver',
    tyloRole: 'Approver',
    huedoraEquivalent: 'reviewer',
    permissions: ['camps:read', 'camps:approve', 'dashboards:read'],
  },
  {
    role: 'CampRequester',
    label: 'Camp Requester',
    tyloRole: 'CampRequester',
    huedoraEquivalent: 'operations_executive',
    permissions: ['camps:read', 'camps:request'],
  },
  {
    role: 'AssetManager',
    label: 'Asset Manager',
    tyloRole: 'AssetManager',
    huedoraEquivalent: 'operations_executive',
    permissions: ['camps:read', 'camps:request', 'imports:execute', 'dashboards:read'],
  },
  {
    role: 'Viewer',
    label: 'Viewer',
    tyloRole: 'Viewer',
    huedoraEquivalent: 'read_only',
    permissions: ['camps:read', 'camps:request', 'dashboards:read'],
  },
];

export function isValidCampName(value) {
  return CAMP_NAME_OPTIONS.includes(String(value || '').trim());
}

export function normalizeCampName(value) {
  const trimmed = String(value || '').trim();
  if (isValidCampName(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (lower.includes('bmd') || lower.includes('classic')) return 'BMD';
  if (lower.includes('diet') || lower.includes('dieit')) return 'Dieitician';
  if (lower.includes('physio') || lower.includes('nuero') || lower.includes('neuro')) {
    return 'Physio & Nuero';
  }
  if (lower.includes('uro')) return 'Uroflow';
  return trimmed || 'Others';
}

export function canTransition(currentStatus, nextStatus) {
  const allowed = CAMP_OPS_STATUS_TRANSITIONS[currentStatus] || [];
  return allowed.includes(nextStatus);
}

export function isCampEditable(status) {
  return EDITABLE_CAMP_STATUSES.includes(status);
}
