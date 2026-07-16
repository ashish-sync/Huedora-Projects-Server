/** Inventory & Logistics — Inventory Ledger transaction config */

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
 * Product Category (Product Master + Ledger)
 */
export const IN_OUT_PRODUCT_TYPES = [
  'Medical Device',
  'Non-Medical Device',
  'Consumable',
  'Spare Part / Accessory',
  'Document',
  'Miscellaneous',
];

export const IN_OUT_PRODUCT_TYPE_ALIASES = {
  Documents: 'Document',
  Document: 'Document',
  'Devices Parts': 'Spare Part / Accessory',
  'Device Part': 'Spare Part / Accessory',
  Accessory: 'Spare Part / Accessory',
  Others: 'Miscellaneous',
  Other: 'Miscellaneous',
};

/** How items are tracked — from Product Master */
export const PRODUCT_TRACKING_KINDS = ['None', 'Serial', 'Batch', 'Batch + Serial'];

/**
 * Defaults by category (Product Master can override)
 * expiryApplicable, trackingKind
 */
export const PRODUCT_CATEGORY_DEFAULTS = {
  'Medical Device': { expiryApplicable: false, trackingKind: 'Serial' },
  'Non-Medical Device': { expiryApplicable: false, trackingKind: 'Serial' },
  Consumable: { expiryApplicable: true, trackingKind: 'Batch' },
  'Spare Part / Accessory': { expiryApplicable: false, trackingKind: 'Batch + Serial' },
  Document: { expiryApplicable: false, trackingKind: 'None' },
  Miscellaneous: { expiryApplicable: false, trackingKind: 'None' },
};

/** @deprecated alias for older meta consumers */
export const PRODUCT_TRACKING_TYPE = Object.fromEntries(
  Object.entries(PRODUCT_CATEGORY_DEFAULTS).map(([k, v]) => [k, v.trackingKind])
);

export const IN_OUT_TRACKING_TYPES = PRODUCT_TRACKING_KINDS;

export const PRODUCT_STATUS_OPTIONS = {
  Consumable: [
    'Available',
    'Reserved',
    'Issued',
    'Expired',
    'Near Expiry',
    'Damaged',
    'Disposed',
  ],
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
  Document: ['Draft', 'Active', 'Expired', 'Archived', 'Cancelled'],
  'Spare Part / Accessory': ['Available', 'Reserved', 'Issued', 'Damaged', 'Disposed'],
  Miscellaneous: ['Available', 'Reserved', 'Issued', 'Damaged', 'Disposed'],
};

export const IN_OUT_STATUSES = [...new Set(Object.values(PRODUCT_STATUS_OPTIONS).flat())];

/** Delivery Mode */
export const DELIVERY_MODES = [
  'Hand Delivery',
  'Porter',
  'Blue Dart',
  'DTDC',
  'Other Courier',
];

/** Modes that require AWB */
export const COURIER_DELIVERY_MODES = ['Blue Dart', 'DTDC', 'Other Courier'];

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
  Consumable: ['qty'],
  'Spare Part / Accessory': ['qty'],
  Document: ['qty'],
  Miscellaneous: ['qty'],
};

export const ENTRY_REQUIRED_FIELDS = {
  Inward: [],
  Outward: ['contactId'],
  Transfer: [],
  Return: ['contactId'],
  'Stock Adjustment': [],
};
