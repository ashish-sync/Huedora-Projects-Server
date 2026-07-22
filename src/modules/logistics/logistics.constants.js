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
  'Peripheral Device',
  'Accessory',
  'Spare Part',
  'Consumable',
  'Document',
  'Other',
];

/** Type-based product code prefixes (MD0001, NM0001, PD0001, …) */
export const PRODUCT_TYPE_CODE_PREFIX = {
  'Medical Device': 'MD',
  'Non-Medical Device': 'NM',
  'Peripheral Device': 'PD',
  Accessory: 'AC',
  'Spare Part': 'SP',
  Consumable: 'CN',
  Document: 'DC',
  Other: 'OT',
};

export const PRODUCT_CODE_FORMAT = { digits: 4, separator: '' };

export const PRODUCT_INVENTORY_TYPES = [
  'Replacement Part for Asset',
  'Accessory of Asset',
  'Consumed by Device',
  'Multi-use',
];

/** Legacy inventory labels → current Product Master set */
export const PRODUCT_INVENTORY_TYPE_ALIASES = {
  'Replacement Part for Asset': 'Replacement Part for Asset',
  'Accessory of Asset': 'Accessory of Asset',
  'Consumed by Device': 'Consumed by Device',
  'Multi-use': 'Multi-use',
  'Associated to Asset': 'Replacement Part for Asset',
  'Used by Device': 'Consumed by Device',
  Asset: 'Replacement Part for Asset',
  'Inventory Item': 'Multi-use',
  'Inventory item': 'Multi-use',
};

export const PRODUCT_COMPATIBILITY_TYPES = ['Accessory', 'Spare Part', 'Other'];

export const GST_RATE_PRESETS = [0, 5, 12, 18, 28];

export const IN_OUT_PRODUCT_TYPE_ALIASES = {
  'Medical Device': 'Medical Device',
  'Non-Medical Device': 'Non-Medical Device',
  'Peripheral Device': 'Peripheral Device',
  Accessory: 'Accessory',
  'Spare Part': 'Spare Part',
  Consumable: 'Consumable',
  Consumables: 'Consumable',
  Document: 'Document',
  Other: 'Other',
  // Legacy catalog values
  Device: 'Medical Device',
  Peripheral: 'Peripheral Device',
  Misc: 'Other',
  Miscellaneous: 'Other',
  'Spare Part / Accessory': 'Spare Part',
  Documents: 'Document',
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
    inventoryType: 'Multi-use',
  },
  'Non-Medical Device': {
    expiryApplicable: false,
    trackingKind: 'Serial',
    inventoryType: 'Multi-use',
  },
  'Peripheral Device': {
    expiryApplicable: false,
    trackingKind: 'Serial',
    inventoryType: 'Multi-use',
  },
  Accessory: {
    expiryApplicable: false,
    trackingKind: 'Serial',
    inventoryType: 'Accessory of Asset',
  },
  'Spare Part': {
    expiryApplicable: false,
    trackingKind: 'Batch + Serial',
    inventoryType: 'Replacement Part for Asset',
  },
  Consumable: {
    expiryApplicable: true,
    trackingKind: 'Batch',
    inventoryType: 'Consumed by Device',
  },
  Document: {
    expiryApplicable: false,
    trackingKind: 'None',
    inventoryType: 'Multi-use',
  },
  Other: {
    expiryApplicable: false,
    trackingKind: 'None',
    inventoryType: 'Consumed by Device',
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
  'Peripheral Device': [
    'Available',
    'Assigned',
    'In Transit',
    'Under Repair',
    'Returned',
    'Retired',
    'Disposed',
  ],
  Accessory: ['Available', 'Reserved', 'Issued', 'Damaged', 'Disposed'],
  'Spare Part': ['Available', 'Reserved', 'Issued', 'Damaged', 'Disposed'],
  Consumable: ['Available', 'Reserved', 'Issued', 'Damaged', 'Disposed', 'Expired'],
  Document: ['Draft', 'Active', 'Expired', 'Archived', 'Cancelled'],
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
  'Peripheral Device': ['qty'],
  Accessory: ['qty'],
  'Spare Part': ['qty'],
  Consumable: ['qty'],
  Document: ['qty'],
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
