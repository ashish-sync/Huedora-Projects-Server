export const ASSET_TYPE_OPTIONS = ['Rented', 'Owned', 'Hybrid'];

/** Sheet label: Asset Status. 8 inventory types */
export const AGREEMENT_STATUS_OPTIONS = [
  'With TCPL',
  'Not Applicable',
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
  'TCPL - Mumbai Warehouse',
  'TCPL - Hyderabad Warehouse',
  'Individual',
  'Service Provider',
  'TCPL - HO',
  'TCPL - Delhi Warehouse',
];

export const ASSET_CUSTODY_OPTIONS = DEVICE_CUSTODY_OPTIONS;

/** 28 Indian states + 8 union territories */
export const INDIAN_STATES_AND_UTS = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
];

/** Legacy / workflow aliases → picklist values */
const AGREEMENT_STATUS_ALIASES = {
  active: 'Agreement Signed',
  signed: 'Agreement Signed',
  'agreement signed': 'Agreement Signed',
  terminated: 'Not Initiated',
  expired: 'Not Initiated',
  inactive: 'Not Initiated',
  'not initiated': 'Not Initiated',
  'not applicable': 'Not Applicable',
  na: 'Not Applicable',
  'n/a': 'Not Applicable',
};

/** Statuses treated as signed for verification board inclusion */
export const AGREEMENT_SIGNED_EQUIVALENTS = ['Agreement Signed', 'Active'];

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
  const hit = DEVICE_CUSTODY_OPTIONS.find((o) => o.toLowerCase() === v.toLowerCase());
  return hit || null;
}

export function normalizeAssetType(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  const hit = ASSET_TYPE_OPTIONS.find((o) => o.toLowerCase() === v.toLowerCase());
  return hit || null;
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
