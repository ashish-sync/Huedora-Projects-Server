/** Server-side master entity catalog for MASTER_ADD validation. */

export const MASTER_MODULES = ['inventory', 'movement', 'document'];

export const MASTER_ENTITY_IDS = [
  'products',
  'categories',
  'uoms',
  'warehouses',
  'locations',
  'stock-statuses',
  'suppliers',
  'vendors',
  'transporters',
  'movement-types',
  'reason-codes',
  'expense-categories',
  'contacts',
  'pin-codes',
  'templates',
  'signatures',
];

/** entityId → module */
export const MASTER_ENTITY_MODULE = {
  products: 'inventory',
  categories: 'inventory',
  uoms: 'inventory',
  warehouses: 'inventory',
  locations: 'inventory',
  'stock-statuses': 'inventory',
  suppliers: 'movement',
  vendors: 'movement',
  transporters: 'movement',
  'movement-types': 'movement',
  'reason-codes': 'movement',
  'expense-categories': 'movement',
  contacts: 'document',
  'pin-codes': 'document',
  templates: 'document',
  signatures: 'document',
};

export const MASTER_REQUIRED_FIELDS = {
  products: ['name', 'productType', 'categoryId', 'brand', 'manufacturer'],
  categories: ['name'],
  uoms: ['name'],
  warehouses: ['name'],
  locations: ['name', 'warehouseId', 'level'],
  'stock-statuses': ['name'],
  suppliers: ['name'],
  vendors: ['name'],
  transporters: ['name'],
  'movement-types': ['name'],
  'reason-codes': ['name'],
  'expense-categories': ['name'],
  contacts: ['name'],
  'pin-codes': ['pinCode', 'cityId'],
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
  if (entityId === 'pin-codes') {
    const pin = String(payload.pinCode || '').replace(/\D+/g, '');
    if (!/^\d{6}$/.test(pin)) return 'PIN code must be 6 digits';
  }
  return '';
}
