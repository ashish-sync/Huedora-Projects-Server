/** Inventory & Logistics. Inventory Ledger transaction config */

export const LOCATION_LEVELS = ['Zone', 'Room', 'Rack', 'Shelf', 'Bin'];

export const DEFAULT_WAREHOUSE_NAME = 'Mumbai';
export const DEFAULT_WAREHOUSE_CODE = 'WH-MUM';

export const DEFAULT_STOCK_STATUSES = [
  'Available',
  'Reserved',
  'Allocated',
  'Picked',
  'Packed',
  'In Transit',
  'Assigned',
  'Returned',
  'Repair',
  'Damaged',
  'Scrapped',
  'Disposed',
];

export const UNAVAILABLE_STOCK_STATUSES = [
  'Reserved',
  'Allocated',
  'Picked',
  'Packed',
  'In Transit',
  'Assigned',
  'Repair',
  'Damaged',
  'Scrapped',
  'Disposed',
];

export const DEFAULT_MOVEMENT_TYPES = [
  { code: 'GRN', name: 'Goods Receipt', direction: 'IN' },
  { code: 'TRF_IN', name: 'Transfer In', direction: 'IN' },
  { code: 'TRF_OUT', name: 'Transfer Out', direction: 'OUT' },
  { code: 'DISPATCH', name: 'Dispatch', direction: 'OUT' },
  { code: 'RETURN', name: 'Return', direction: 'IN' },
  { code: 'ADJUST_IN', name: 'Adjustment In', direction: 'IN' },
  { code: 'ADJUST_OUT', name: 'Adjustment Out', direction: 'OUT' },
  { code: 'SCRAP', name: 'Scrap', direction: 'OUT' },
  { code: 'LOSS', name: 'Loss', direction: 'OUT' },
];

export const DEFAULT_REASON_CODES = [
  { code: 'DAMAGED', name: 'Damaged on receipt' },
  { code: 'SHORT', name: 'Shortage' },
  { code: 'EXCESS', name: 'Excess' },
  { code: 'COUNT', name: 'Physical count variance' },
  { code: 'QUALITY', name: 'Quality rejection' },
  { code: 'OBSOLETE', name: 'Obsolete / EOL' },
  { code: 'OTHER', name: 'Other' },
];

/** Standard units of measure — seeded by code or name (no duplicates). */
export const DEFAULT_UOMS = [
  { code: 'EA', name: 'Each' },
  { code: 'NOS', name: 'Number' },
  { code: 'BOX', name: 'Box' },
  { code: 'PK', name: 'Pack' },
  { code: 'SET', name: 'Set' },
  { code: 'PR', name: 'Pair' },
  { code: 'ROLL', name: 'Roll' },
];

/** Additional UOMs for existing products and imports. */
export const SUPPLEMENTAL_UOMS = [
  { code: 'PCS', name: 'Piece' },
  { code: 'KIT', name: 'Kit' },
  { code: 'CTN', name: 'Carton' },
  { code: 'BTL', name: 'Bottle' },
  { code: 'DOC', name: 'Document' },
];

/** Legacy UOM codes normalized to current codes. */
export const UOM_LEGACY_CODE_ALIASES = {
  PACK: 'PK',
  PAIR: 'PR',
};

export const MASTER_ENTITIES = [
  'warehouses',
  'locations',
  'suppliers',
  'vendors',
  'transporters',
  'categories',
  'products',
  'uoms',
  'stockStatuses',
  'movementTypes',
  'reasonCodes',
];

/** Entry Type */
export const IN_OUT_ENTRY_TYPES = [
  'Inward',
  'Outward',
  'Transfer',
  'Return',
  'Stock Adjustment',
];

export const IN_OUT_ENTRY_TYPE_ALIASES = {
  Transfers: 'Transfer',
  Returns: 'Return',
  'Stock Adjustments': 'Stock Adjustment',
};

export const IN_OUT_DEFAULT_PROCESS = {
  Inward: 'Goods Receipt',
  Outward: 'Dispatch',
  Transfer: 'Transfer',
  Return: 'Return',
  'Stock Adjustment': 'Adjustment',
};

export const IN_OUT_PROCESSES = [
  'Goods Receipt',
  'Dispatch',
  'Transfer',
  'Return',
  'Adjustment',
  'Other',
];

/**
 * Product types (Product Master + Ledger)
 */
export const IN_OUT_PRODUCT_TYPES = [
  'Medical Device',
  'Non-Medical Device',
  'Peripheral',
  'Consumable',
  'Spare Part',
  'Other',
];

/** Medical Device product categories (same as camp / hiring methods). */
export const MEDICAL_DEVICE_PRODUCT_CATEGORIES = [
  'BMD',
  'Diagnostics',
  'Uroflow',
  'Dietician',
  'Neuro & Physio',
  'Others',
];

export const MEDICAL_DEVICE_CATEGORY_ALIASES = {
  BMD: 'BMD',
  Diagnostics: 'Diagnostics',
  Diagnostic: 'Diagnostics',
  Daignostics: 'Diagnostics',
  Uroflow: 'Uroflow',
  Dietician: 'Dietician',
  Dietitian: 'Dietician',
  'Neuro & Physio': 'Neuro & Physio',
  'Physio & Neuro': 'Neuro & Physio',
  'Physio & Nuero': 'Neuro & Physio',
  Others: 'Others',
  Other: 'Others',
  Therapeutic: 'Others',
  Monitoring: 'Others',
  Imaging: 'Others',
  Laboratory: 'Others',
  Surgical: 'Others',
  'Life Support': 'Others',
};

/** Type-based product code prefixes (MD0001, NMD0001, PER0001, …) */
export const PRODUCT_TYPE_CODE_PREFIX = {
  'Medical Device': 'MD',
  'Non-Medical Device': 'NMD',
  Peripheral: 'PER',
  Consumable: 'CON',
  'Spare Part': 'SP',
  Other: 'OTH',
};

export const PRODUCT_CODE_FORMAT = { digits: 4, separator: '' };

export const PRODUCT_INVENTORY_TYPES = ['Asset', 'Inventory'];

/** Allowed inventory class per product type. */
export const INVENTORY_TYPES_BY_PRODUCT_TYPE = {
  'Medical Device': ['Asset'],
  'Non-Medical Device': ['Asset'],
  Peripheral: ['Inventory'],
  Consumable: ['Inventory'],
  'Spare Part': ['Inventory'],
  Other: ['Inventory'],
};

export function resolveInventoryTypeForProductType(productType, raw) {
  const type = String(productType || '').trim();
  const allowed = INVENTORY_TYPES_BY_PRODUCT_TYPE[type] || ['Inventory'];
  let v = String(raw || '').trim();
  if (PRODUCT_INVENTORY_TYPE_ALIASES[v]) v = PRODUCT_INVENTORY_TYPE_ALIASES[v];
  if (allowed.includes(v)) return v;
  return allowed[0];
}

/** Legacy inventory labels → Asset | Inventory */
export const PRODUCT_INVENTORY_TYPE_ALIASES = {
  Asset: 'Asset',
  Inventory: 'Inventory',
  'Multi-use': 'Asset',
  'Replacement Part for Asset': 'Inventory',
  'Accessory of Asset': 'Inventory',
  'Consumed by Device': 'Inventory',
  'Associated to Asset': 'Inventory',
  'Used by Device': 'Inventory',
  'Inventory Item': 'Inventory',
  'Inventory item': 'Inventory',
};

export const PRODUCT_COMPATIBILITY_TYPES = ['Spare Part', 'Other'];

export const GST_RATE_PRESETS = [0, 5, 12, 18, 28];

export const IN_OUT_PRODUCT_TYPE_ALIASES = {
  'Medical Device': 'Medical Device',
  'Non-Medical Device': 'Non-Medical Device',
  Peripheral: 'Peripheral',
  Consumable: 'Consumable',
  Consumables: 'Consumable',
  'Spare Part': 'Spare Part',
  Other: 'Other',
  // Legacy catalog values
  Device: 'Medical Device',
  'Peripheral Device': 'Peripheral',
  Accessory: 'Spare Part',
  Document: 'Other',
  Misc: 'Other',
  Miscellaneous: 'Other',
  'Spare Part / Accessory': 'Spare Part',
  Documents: 'Other',
  'Devices Parts': 'Spare Part',
  'Device Part': 'Spare Part',
  Others: 'Other',
};

/** How items are tracked. from Product Master */
export const PRODUCT_TRACKING_KINDS = ['None', 'Serial', 'Batch', 'Batch + Serial'];

/**
 * Defaults by category (Product Master can override)
 * expiryApplicable, trackingKind, inventoryType
 */
export const PRODUCT_CATEGORY_DEFAULTS = {
  'Medical Device': {
    expiryApplicable: false,
    trackingKind: 'Serial',
    inventoryType: 'Asset',
    calibrationRequired: true,
  },
  'Non-Medical Device': {
    expiryApplicable: false,
    trackingKind: 'Serial',
    inventoryType: 'Asset',
    calibrationRequired: false,
  },
  Peripheral: {
    expiryApplicable: false,
    trackingKind: 'Serial',
    inventoryType: 'Inventory',
    calibrationRequired: false,
  },
  Consumable: {
    expiryApplicable: true,
    trackingKind: 'Batch',
    inventoryType: 'Inventory',
    calibrationRequired: false,
  },
  'Spare Part': {
    expiryApplicable: false,
    trackingKind: 'Batch + Serial',
    inventoryType: 'Inventory',
    calibrationRequired: false,
  },
  Other: {
    expiryApplicable: false,
    trackingKind: 'None',
    inventoryType: 'Inventory',
    calibrationRequired: false,
  },
};

/** @deprecated alias for older meta consumers */
export const PRODUCT_TRACKING_TYPE = Object.fromEntries(
  Object.entries(PRODUCT_CATEGORY_DEFAULTS).map(([k, v]) => [k, v.trackingKind])
);

export const IN_OUT_TRACKING_TYPES = PRODUCT_TRACKING_KINDS;

export const PRODUCT_STATUS_OPTIONS = {
  'Medical Device': [
    'Available',
    'Assigned',
    'In Transit',
    'Under Repair',
    'Returned',
    'Retired',
    'Disposed',
  ],
  'Non-Medical Device': [
    'Available',
    'Assigned',
    'In Transit',
    'Under Repair',
    'Returned',
    'Retired',
    'Disposed',
  ],
  Peripheral: [
    'Available',
    'Assigned',
    'In Transit',
    'Under Repair',
    'Returned',
    'Retired',
    'Disposed',
  ],
  'Spare Part': ['Available', 'Reserved', 'Issued', 'Damaged', 'Disposed'],
  Consumable: ['Available', 'Reserved', 'Issued', 'Damaged', 'Disposed', 'Expired'],
  Other: ['Available', 'Reserved', 'Issued', 'Damaged', 'Disposed'],
};

export const IN_OUT_STATUSES = [...new Set(Object.values(PRODUCT_STATUS_OPTIONS).flat())];

/** Inward with remaining life shorter than this requires Approved By */
export const SHORT_EXPIRY_APPROVAL_MONTHS = 12;

/**
 * Whole months remaining from `fromDate` (default today) until `expiryDate`.
 * Returns null when dates are invalid.
 */
export function monthsUntilExpiry(expiryDate, fromDate = new Date()) {
  const exp = new Date(String(expiryDate || '').slice(0, 10));
  const from = new Date(String(fromDate || '').slice(0, 10));
  if (Number.isNaN(exp.getTime()) || Number.isNaN(from.getTime())) return null;
  let months = (exp.getFullYear() - from.getFullYear()) * 12 + (exp.getMonth() - from.getMonth());
  if (exp.getDate() < from.getDate()) months -= 1;
  return months;
}

/** True when expiry is set and remaining life is under SHORT_EXPIRY_APPROVAL_MONTHS. */
export function requiresShortExpiryApproval(expiryDate, fromDate = new Date()) {
  const months = monthsUntilExpiry(expiryDate, fromDate);
  if (months == null) return false;
  return months < SHORT_EXPIRY_APPROVAL_MONTHS;
}

/** Delivery Mode */
export const DELIVERY_MODES = [
  'Hand Delivery',
  'Regular Courier',
  'Apex',
  'Porter',
  'Other',
  'Blue Dart',
  'DTDC',
  'Other Courier',
];

export const DELIVERY_MODE_ALIASES = {
  Courier: 'Regular Courier',
  'Hand-carry': 'Hand Delivery',
  Road: 'Other',
};

/** Modes that require AWB */
export const COURIER_DELIVERY_MODES = [
  'Regular Courier',
  'Apex',
  'Blue Dart',
  'DTDC',
  'Other Courier',
];

/**
 * Outward / goods-issue lifecycle (separate from product stock `status`).
 * Stays Open after dispatch until AWB / delivery is marked Delivered, RTO, or Closed.
 */
export const OUTWARD_DISPATCH_STATUSES = ['Open', 'Delivered', 'RTO', 'Closed'];
export const OUTWARD_OPEN_DISPATCH_STATUS = 'Open';
export const OUTWARD_TERMINAL_DISPATCH_STATUSES = ['Delivered', 'RTO', 'Closed'];
export const OUTWARD_DELIVERY_OUTCOMES = ['Delivered', 'RTO', 'Closed'];

export const IN_OUT_MODES = DELIVERY_MODES;

export const ADJUSTMENT_TYPES = ['Increase', 'Decrease'];
export const ADJUSTMENT_REASONS = [
  'Damage',
  'Lost',
  'Expired',
  'Audit',
  'Correction',
  'Others',
];

export const DEVICE_CONDITIONS = ['New', 'Good', 'Fair', 'Damaged', 'Needs Repair'];
export const INSPECTION_STATUSES = ['Pending', 'Passed', 'Failed', 'Partial'];
export const DOCUMENT_TYPES = [
  'Agreement',
  'Invoice',
  'Warranty',
  'Manual',
  'Certificate',
  'Other',
];

/** Simplified required rules for new ledger form */
export const PRODUCT_REQUIRED_FIELDS = {
  'Medical Device': ['qty'],
  'Non-Medical Device': ['qty'],
  Peripheral: ['qty'],
  Consumable: ['qty'],
  'Spare Part': ['qty'],
  Other: ['qty'],
  // Legacy keys still present on older stock / txn rows
  Device: ['qty'],
  Misc: ['qty'],
};

export const ENTRY_REQUIRED_FIELDS = {
  Inward: [],
  Outward: ['contactId'],
  Transfer: [],
  Return: ['contactId'],
  'Stock Adjustment': [],
};

/** Finance master. Expense Categories (Request Center reimbursements) */
export const DEFAULT_EXPENSE_CATEGORIES = [
  {
    code: 'EMP_EXP',
    name: 'Employee Expenses',
    covers: 'Salaries, benefits, reimbursements, training',
  },
  {
    code: 'MED_OPS',
    name: 'Medical Operations',
    covers: 'Devices, consumables, medicines, diagnostics, camps',
  },
  {
    code: 'OFF_FAC',
    name: 'Office & Facilities',
    covers: 'Rent, utilities, housekeeping, office supplies',
  },
  {
    code: 'IT_TECH',
    name: 'IT & Technology',
    covers: 'Hardware, software, SaaS, cloud, telecom',
  },
  {
    code: 'LOG_TRV',
    name: 'Logistics & Travel',
    covers: 'Courier, freight, vehicles, travel, accommodation',
  },
  {
    code: 'SALES_MKT',
    name: 'Sales & Marketing',
    covers: 'Advertising, branding, events, promotions',
  },
  {
    code: 'PROF_SVC',
    name: 'Professional Services',
    covers: 'Consultants, legal, audit, recruitment',
  },
  {
    code: 'FIN_COMP',
    name: 'Finance & Compliance',
    covers: 'Taxes, insurance, bank charges, licenses',
  },
  {
    code: 'ASSET_MNT',
    name: 'Asset & Maintenance',
    covers: 'Purchase, AMC, repairs, rentals',
  },
  {
    code: 'MISC',
    name: 'Miscellaneous',
    covers: 'Petty cash, internal transfers, uncategorized',
  },
];
