/** Server-side master entity catalog for MASTER_ADD validation. */

export const MASTER_MODULES = ['inventory', 'movement', 'document'];

export const MASTER_ENTITY_IDS = [
  'products',
  'parties',
  'expense-categories',
  'contacts',
  'templates',
  'signatures',
];

/** entityId → module */
export const MASTER_ENTITY_MODULE = {
  products: 'inventory',
  parties: 'movement',
  'expense-categories': 'movement',
  contacts: 'document',
  templates: 'document',
  signatures: 'document',
};

export const MASTER_REQUIRED_FIELDS = {
  products: ['model', 'productType', 'brand'],
  parties: ['name', 'partyType'],
  'expense-categories': ['name'],
  contacts: ['name'],
  templates: ['name', 'documentType', 'signingType'],
  signatures: ['name', 'roleLabel', 'typedName'],
};

export function moduleForEntity(entityId) {
  return MASTER_ENTITY_MODULE[entityId] || '';
}

export function validateMasterAddPayload(entityId, payload = {}) {
  if (!MASTER_ENTITY_IDS.includes(entityId)) {
    return 'Unknown master entity';
  }
  const required = MASTER_REQUIRED_FIELDS[entityId] || [];
  for (const key of required) {
    const v = payload[key];
    if (v == null || String(v).trim() === '') {
      return `${key} is required`;
    }
  }
  if (entityId === 'contacts') {
    const email = String(payload.email || '').trim();
    const phone = String(payload.contact || payload.phone || '').trim();
    if (!email && !phone) return 'Email or phone is required for a contact';
  }
  return '';
}
