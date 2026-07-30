/** Server-side master entity catalog for MASTER_ADD validation. */

import { isValidEmail, isValidPhone } from '../../utils/identityNormalize.js';

export const MASTER_MODULES = ['inventory', 'movement', 'document', 'camp'];

export const MASTER_ENTITY_IDS = [
  'products',
  'parties',
  'expense-categories',
  'contacts',
  'templates',
  'signatures',
  'pin-codes',
];

/** entityId → module */
export const MASTER_ENTITY_MODULE = {
  products: 'inventory',
  parties: 'movement',
  'expense-categories': 'movement',
  contacts: 'document',
  templates: 'document',
  signatures: 'document',
  'pin-codes': 'camp',
};

export const MASTER_REQUIRED_FIELDS = {
  products: ['model', 'productType', 'brand'],
  parties: ['name', 'partyType'],
  'expense-categories': ['name'],
  contacts: ['name'],
  templates: ['name', 'documentType', 'signingType'],
  signatures: ['name', 'roleLabel', 'typedName'],
  'pin-codes': ['pinCode', 'stateName'],
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
    if (!email && !phone) return 'Email or mobile number is required for a contact';
    if (email && !isValidEmail(email)) {
      return 'Email must include @ and a valid domain suffix (e.g. .com, .in, .net)';
    }
    if (phone && !isValidPhone(phone)) return 'Mobile number must be exactly 10 digits';
  }
  if (entityId === 'parties') {
    const email = String(payload.email || '').trim();
    const phone = String(payload.phone || '').trim();
    if (email && !isValidEmail(email)) {
      return 'Email must include @ and a valid domain suffix (e.g. .com, .in, .net)';
    }
    if (phone && !isValidPhone(phone)) return 'Mobile number must be exactly 10 digits';
  }
  return '';
}
