/** Product master excel columns — sample matches ProductMasterPage form; export includes system fields. */

/** Form-aligned columns for import sample download. */
export const PRODUCT_SAMPLE_HEADERS = [
  'Product Category',
  'Method',
  'Product Code',
  'Brand - Manufacturer',
  'Model - Variant',
  'Display Name',
  'UOM',
  'Track Inventory By',
  'Expiry Applicable',
  'Reorder Level',
  'Status',
];

/** Export matches the same field order as the New Product form. */
export const PRODUCT_EXPORT_HEADERS = [
  'Product Category',
  'Method',
  'Product Code',
  'Brand - Manufacturer',
  'Model - Variant',
  'Display Name',
  'UOM',
  'Track Inventory By',
  'Expiry Applicable',
  'Reorder Level',
  'Status',
];

export const PRODUCT_HEADERS = PRODUCT_EXPORT_HEADERS;

export const PRODUCT_SAMPLE_ROWS = [
  [
    'Consumable',
    'Medical Consumable',
    '',
    'MediGel',
    '250ml',
    'MediGel — Ultrasound Gel 250ml',
    'Bottle (BTL)',
    'Batch',
    'Yes',
    50,
    'Active',
  ],
  [
    'Medical Device',
    'BMD',
    '',
    'CarePlus',
    'ProScan X1',
    'CarePlus — ProScan X1',
    'Each (EA)',
    'Serial Number',
    'No',
    '',
    'Active',
  ],
];

export const PRODUCT_IMPORT_COLUMNS = [
  {
    labels: ['Product Type', 'Type', 'Product Category'],
    field: 'productType',
    required: true,
  },
  {
    labels: ['Method', 'Product Category', 'Category'],
    field: 'productCategory',
    optional: true,
  },
  { labels: ['Product Code', 'Code'], field: 'code', optional: true },
  {
    labels: ['Brand - Manufacturer', 'Brand / Manufacturer', 'Brand'],
    field: 'brand',
    required: true,
  },
  {
    labels: ['Model - Variant', 'Model / Variant', 'Model/Variant/Name', 'Model', 'Variant'],
    field: 'model',
    required: true,
  },
  {
    labels: ['Display Name', 'Product Name', 'Name'],
    field: 'name',
    optional: true,
  },
  {
    labels: ['UOM', 'Unit of Measure (UOM)', 'Select UOM', 'UOM Name', 'UOM Code'],
    field: 'uom',
    optional: true,
  },
  {
    labels: [
      'Track Inventory By',
      'Inventory Tracking',
      'Tracking',
      'Tracking Kind',
    ],
    field: 'trackingKind',
    optional: true,
  },
  { labels: ['Expiry Applicable'], field: 'expiryApplicable', type: 'bool', defaultValue: false },
  {
    labels: ['Reorder Level', 'Minimum Stock Level', 'Min Stock'],
    field: 'reorderLevel',
    type: 'number',
    defaultValue: 0,
  },
  {
    labels: ['Status', 'Active'],
    field: 'isActive',
    type: 'bool',
    defaultValue: true,
  },
];
