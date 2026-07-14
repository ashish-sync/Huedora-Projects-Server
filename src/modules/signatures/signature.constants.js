export const SIGNATURE_ROLES = [
  'HR',
  'Director Finance',
  'CFO',
  'CEO',
  'Legal',
  'Asset Manager',
  'Procurement',
  'Operations',
  'Verifier',
  'Other',
];

export function matchSignatureRole(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const found = SIGNATURE_ROLES.find((r) => r.toLowerCase() === raw.toLowerCase());
  return found || raw;
}
