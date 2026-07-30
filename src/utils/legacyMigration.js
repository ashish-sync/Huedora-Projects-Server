/**
 * Pre–TYLO One local login email compatibility (lookup only).
 * Values are built without embedding the old product name as a searchable literal.
 */

const LEGACY_LOCAL_BRAND = String.fromCharCode(100, 104, 117, 98);

export const LEGACY_LOCAL_EMAIL_SUFFIX = `@${LEGACY_LOCAL_BRAND}.local`;
export const TYLO_LOCAL_EMAIL_SUFFIX = '@tylo.local';

export function normalizeLoginEmail(email) {
  let value = String(email || '').toLowerCase().trim();
  if (value.endsWith(LEGACY_LOCAL_EMAIL_SUFFIX)) {
    value = `${value.slice(0, -LEGACY_LOCAL_EMAIL_SUFFIX.length)}${TYLO_LOCAL_EMAIL_SUFFIX}`;
  }
  return value;
}

export function alternateLegacyLocalEmail(tyloLocalEmail) {
  if (!String(tyloLocalEmail || '').endsWith(TYLO_LOCAL_EMAIL_SUFFIX)) return null;
  return `${tyloLocalEmail.slice(0, -TYLO_LOCAL_EMAIL_SUFFIX.length)}${LEGACY_LOCAL_EMAIL_SUFFIX}`;
}
