import { INDIAN_STATE_NAMES } from '../geo/indianStateNames.js';

export const OWNERSHIP_TYPE_OPTIONS = [
  'Client Owned',
  'Tylo Owned',
  'Rented Asset',
];

const OWNERSHIP_TYPE_ALIASES = {
  owned: 'Tylo Owned',
  'company owned': 'Tylo Owned',
  'company-owned': 'Tylo Owned',
  'tylo owned': 'Tylo Owned',
  rented: 'Rented Asset',
  'rented asset': 'Rented Asset',
  'client owned': 'Client Owned',
  'client-owned': 'Client Owned',
  hybrid: 'Tylo Owned',
};

/** Sheet label: Asset Status */
export const AGREEMENT_STATUS_OPTIONS = [
  'With TCPL',
  'Lost/Stolen',
  'Agreement Signed',
  'Not Initiated',
  'Under Repairs',
  'Untraceable',
  'End of Life',
];

export const ASSET_STATUS_OPTIONS = AGREEMENT_STATUS_OPTIONS;

/** Sheet label: Asset Custody */
export const DEVICE_CUSTODY_OPTIONS = [
  'Client / Rented',
  'Tylo Office',
  'Individual',
  'Service Provider',
];

export const ASSET_CUSTODY_OPTIONS = DEVICE_CUSTODY_OPTIONS;

export const INDIAN_STATES_AND_UTS = INDIAN_STATE_NAMES;

/** Legacy / workflow aliases → picklist values */
const AGREEMENT_STATUS_ALIASES = {
  active: 'Agreement Signed',
  signed: 'Agreement Signed',
  'agreement signed': 'Agreement Signed',
  terminated: 'Not Initiated',
  expired: 'Not Initiated',
  inactive: 'Not Initiated',
  'not initiated': 'Not Initiated',
  'not applicable': 'Not Initiated',
  na: 'Not Initiated',
  'n/a': 'Not Initiated',
};

/** Statuses treated as signed for verification board inclusion */
export const AGREEMENT_SIGNED_EQUIVALENTS = ['Agreement Signed', 'Active'];

/**
 * Medical Device asset statuses included on Verification One (monthly rounds).
 * With TCPL, Agreement Signed, and Not Initiated.
 */
export const VERIFICATION_ONE_ELIGIBLE_STATUSES = [
  'With TCPL',
  'Agreement Signed',
  'Not Initiated',
];

export function isMedicalDeviceProductType(raw) {
  const t = String(raw || '').trim();
  return !t || t === 'Medical Device';
}

export function verificationOneAgreementStatus(raw) {
  const v = String(raw || '').trim();
  if (!v) return 'Not Initiated';
  if (v.toLowerCase() === 'active') return 'Agreement Signed';
  const n = normalizeAgreementStatus(v);
  return n || v;
}

export function isVerificationOneEligibleAsset(asset) {
  if (!asset || asset.isDeleted) return false;
  if (!isMedicalDeviceProductType(asset.productType)) return false;
  return VERIFICATION_ONE_ELIGIBLE_STATUSES.includes(
    verificationOneAgreementStatus(asset.agreementStatus)
  );
}

/** Mongo filter: legacy rows without productType count as Medical Device */
export function medicalDeviceProductTypeQuery() {
  return {
    $or: [
      { productType: 'Medical Device' },
      { productType: { $exists: false } },
      { productType: null },
      { productType: '' },
    ],
  };
}

export function normalizeAgreementStatus(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  const alias = AGREEMENT_STATUS_ALIASES[v.toLowerCase()];
  if (alias) return alias;
  const hit = AGREEMENT_STATUS_OPTIONS.find((o) => o.toLowerCase() === v.toLowerCase());
  return hit || null;
}

export function isAgreementSignedStatus(raw) {
  const n = normalizeAgreementStatus(raw);
  return n === 'Agreement Signed' || String(raw || '').trim().toLowerCase() === 'active';
}

export function normalizeDeviceCustody(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  const aliases = {
    'tylo office': 'Tylo Office',
    'tcpl - mumbai warehouse': 'Tylo Office',
    'tcpl - hyderabad warehouse': 'Tylo Office',
    'tcpl - delhi warehouse': 'Tylo Office',
    'tcpl - ho': 'Tylo Office',
    'tcpl - head office': 'Tylo Office',
    'tpcl - warehouse': 'Tylo Office',
    'tcpl - warehouse': 'Tylo Office',
  };
  const alias = aliases[v.toLowerCase()];
  if (alias) return alias;
  const hit = DEVICE_CUSTODY_OPTIONS.find((o) => o.toLowerCase() === v.toLowerCase());
  return hit || null;
}

export function normalizeAssetType(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  const alias = OWNERSHIP_TYPE_ALIASES[v.toLowerCase()];
  if (alias) return alias;
  const hit = OWNERSHIP_TYPE_OPTIONS.find((o) => o.toLowerCase() === v.toLowerCase());
  return hit || null;
}

export function formatOwnershipType(raw) {
  return normalizeAssetType(raw) || String(raw || '').trim() || '';
}

export function normalizeCustodianState(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  const norm = v.toLowerCase().replace(/[\s_-]+/g, '');
  const hit = INDIAN_STATES_AND_UTS.find(
    (o) => o.toLowerCase().replace(/[\s_-]+/g, '') === norm
  );
  if (hit) return hit;
  // common short aliases
  const aliases = {
    an: 'Andaman and Nicobar Islands',
    andaman: 'Andaman and Nicobar Islands',
    delhi: 'Delhi',
    nctofdelhi: 'Delhi',
    newdelhi: 'Delhi',
    jk: 'Jammu and Kashmir',
    jammu: 'Jammu and Kashmir',
    dnhdd: 'Dadra and Nagar Haveli and Daman and Diu',
    dadraandnagarhaveli: 'Dadra and Nagar Haveli and Daman and Diu',
    damananddiu: 'Dadra and Nagar Haveli and Daman and Diu',
    pondicherry: 'Puducherry',
    orissa: 'Odisha',
  };
  return aliases[norm] || null;
}
