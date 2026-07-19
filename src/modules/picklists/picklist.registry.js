import {
  RESOURCE_TYPES,
  PROFESSIONS,
  CLIENT_PROFESSIONS,
  VENDOR_PROFESSIONS,
  SUPPLY_CATEGORIES,
} from '../contacts/contact.constants.js';
import { EXPENSE_CATEGORIES, PAYMENT_MODES } from '../finance/finance.constants.js';
import { DELIVERY_MODES } from '../logistics/logistics.constants.js';
import { SIGNATURE_ROLES } from '../signatures/signature.constants.js';

/** Hiring / transport picklists mirrored from Request One */
export const HCW_TYPES = ['Phlebotomist', 'Technician', 'Dietitian', 'Physio', 'Others'];
export const HIRING_METHODS = ['BMD', 'Diagnostics', 'Uroflow', 'Dietitian', 'Others'];

/**
 * Registry of dropdowns that support Other → custom value → approval.
 * staticOptions should include the Other/Others sentinel as the last (or near-last) entry.
 */
export const PICKLIST_REGISTRY = {
  'contact.resourceType': {
    label: 'Resource Type',
    staticOptions: RESOURCE_TYPES,
    otherLabel: 'Other',
  },
  'contact.profession': {
    label: 'Profession / Role',
    staticOptions: PROFESSIONS,
    otherLabel: 'Other',
  },
  'contact.profession.client': {
    label: 'Profession / Role (Client)',
    staticOptions: CLIENT_PROFESSIONS,
    otherLabel: 'Other',
  },
  'contact.profession.vendor': {
    label: 'Profession / Role (Vendor)',
    staticOptions: VENDOR_PROFESSIONS,
    otherLabel: 'Other',
  },
  'contact.supplyCategory': {
    label: 'Supply Category',
    staticOptions: SUPPLY_CATEGORIES,
    otherLabel: 'Other',
  },
  'finance.category': {
    label: 'Expense Category',
    staticOptions: EXPENSE_CATEGORIES,
    otherLabel: 'Other',
  },
  'finance.paymentMode': {
    label: 'Payment Mode',
    staticOptions: PAYMENT_MODES,
    otherLabel: 'Other',
  },
  'logistics.deliveryMode': {
    label: 'Delivery Mode',
    staticOptions: DELIVERY_MODES,
    otherLabel: 'Other',
  },
  'hiring.hcwType': {
    label: 'HCW Type',
    staticOptions: HCW_TYPES,
    otherLabel: 'Others',
  },
  'hiring.method': {
    label: 'Hiring Method',
    staticOptions: HIRING_METHODS,
    otherLabel: 'Others',
  },
  'signature.role': {
    label: 'Signature Role',
    staticOptions: SIGNATURE_ROLES,
    otherLabel: 'Other',
  },
};

export function normalizePicklistValue(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function getRegistryEntry(key) {
  return PICKLIST_REGISTRY[key] || null;
}

/** Options shown in UI: static (deduped) + approved extras, with Other sentinel last */
export function mergePicklistOptions(staticOptions, approvedValues, otherLabel = 'Other') {
  const seen = new Set();
  const out = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (!s) return;
    const n = normalizePicklistValue(s);
    if (seen.has(n)) return;
    if (n === normalizePicklistValue(otherLabel)) return; // append sentinel last
    seen.add(n);
    out.push(s);
  };
  for (const v of staticOptions || []) push(v);
  for (const v of approvedValues || []) push(v);
  out.push(otherLabel);
  return out;
}
