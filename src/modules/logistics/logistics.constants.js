/** Inventory & Logistics. Inventory Ledger transaction config */

export const LOCATION_LEVELS = ['Zone', 'Room', 'Rack', 'Shelf', 'Bin'];

export const DEFAULT_WAREHOUSE_NAME = 'Mumbai Warehouse';
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
  'Device',
  'Consumable',
  'Accessory',
  'Spare Part',
  'Document',
  'Misc',
];

/** Type-based product code prefixes (DEV-000001, CON-000001, …) */
export const PRODUCT_TYPE_CODE_PREFIX = {
  Device: 'DEV',
  Consumable: 'CON',
  Accessory: 'ACC',
  'Spare Part': 'SPR',
  Document: 'DOC',
  Misc: 'MSC',
};

export const PRODUCT_INVENTORY_TYPES = ['Asset', 'Inventory Item'];

export const PRODUCT_COMPATIBILITY_TYPES = ['Consumable', 'Accessory', 'Spare Part'];

export const IN_OUT_PRODUCT_TYPE_ALIASES = {
  // Canonical short names
  Device: 'Device',
  Consumable: 'Consumable',
  Accessory: 'Accessory',
  'Spare Part': 'Spare Part',
  Document: 'Document',
  Misc: 'Misc',
  // Legacy catalog values
  'Medical Device': 'Device',
  'Non-Medical Device': 'Device',
  'Spare Part / Accessory': 'Spare Part',
  Miscellaneous: 'Misc',
  // Common variants
  Documents: 'Document',
  'Devices Parts': 'Spare Part',
  'Device Part': 'Spare Part',
  Others: 'Misc',
  Other: 'Misc',
};

/** How items are tracked. from Product Master */
export const PRODUCT_TRACKING_KINDS = ['None', 'Serial', 'Batch', 'Batch + Serial'];

/**
 * Defaults by category (Product Master can override)
 * expiryApplicable, trackingKind
 */
export const PRODUCT_CATEGORY_DEFAULTS = {
  Device: { expiryApplicable: false, trackingKind: 'Serial' },
  Consumable: { expiryApplicable: true, trackingKind: 'Batch' },
  Accessory: { expiryApplicable: false, trackingKind: 'Serial' },
  'Spare Part': { expiryApplicable: false, trackingKind: 'Batch + Serial' },
  Document: { expiryApplicable: false, trackingKind: 'None' },
  Misc: { expiryApplicable: false, trackingKind: 'None' },
};

/** @deprecated alias for older meta consumers */
export const PRODUCT_TRACKING_TYPE = Object.fromEntries(
  Object.entries(PRODUCT_CATEGORY_DEFAULTS).map(([k, v]) => [k, v.trackingKind])
);

export const IN_OUT_TRACKING_TYPES = PRODUCT_TRACKING_KINDS;

export const PRODUCT_STATUS_OPTIONS = {
  Device: [
    'Available',
    'Assigned',
    'In Transit',
    'Under Repair',
    'Returned',
    'Retired',
    'Disposed',
  ],
  Consumable: [
    'Available',
    'Reserved',
    'Issued',
    'Expired',
    'Near Expiry',
    'Damaged',
    'Disposed',
  ],
  Accessory: ['Available', 'Reserved', 'Issued', 'Damaged', 'Disposed'],
  'Spare Part': ['Available', 'Reserved', 'Issued', 'Damaged', 'Disposed'],
  Document: ['Draft', 'Active', 'Expired', 'Archived', 'Cancelled'],
  Misc: ['Available', 'Reserved', 'Issued', 'Damaged', 'Disposed'],
};

export const IN_OUT_STATUSES = [...new Set(Object.values(PRODUCT_STATUS_OPTIONS).flat())];

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
  Device: ['qty'],
  Consumable: ['qty'],
  Accessory: ['qty'],
  'Spare Part': ['qty'],
  Document: ['qty'],
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
