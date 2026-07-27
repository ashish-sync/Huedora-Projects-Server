/** Product master excel columns — sample matches ProductMasterPage form; export includes system fields. */

/** Form-aligned columns for import sample download. */
export const PRODUCT_SAMPLE_HEADERS = [
  'Product Type',
  'Product Category',
  'Brand / Manufacturer',
  'Model / Variant',
  'Product Name',
  'Description',
  'UOM',
  'Units per Pack',
  'Default Purchase Cost',
  'Default GST (%)',
  'Expiry Applicable',
  'Warranty (Months)',
  'Reorder Level',
  'Active',
  'Remarks',
];

/** Export includes auto-generated / derived fields. */
export const PRODUCT_EXPORT_HEADERS = [
  'Product Type',
  'Product Code',
  'Product Category',
  'Brand / Manufacturer',
  'Model / Variant',
  'Product Name',
  'Description',
  'UOM',
  'Units per Pack',
  'Default Purchase Cost',
  'Default GST (%)',
  'Inventory Type',
  'Expiry Applicable',
  'Warranty (Months)',
  'Reorder Level',
  'Active',
  'Remarks',
];

export const PRODUCT_HEADERS = PRODUCT_EXPORT_HEADERS;

export const PRODUCT_SAMPLE_ROWS = [
  [
    'Consumable',
    'Medical Consumable',
    'MediGel',
    '250ml',
    'MediGel — Ultrasound Gel 250ml',
    'Ultrasound coupling gel',
    'Bottle (BTL)',
    1,
    120,
    12,
    'Yes',
    0,
    50,
    'Yes',
    '',
  ],
  [
    'Medical Device',
    'BMD',
    'CarePlus',
    'BP Monitor Pro',
    'CarePlus — BP Monitor Pro',
    'Digital blood pressure monitor',
    'Each (EA)',
    1,
    8500,
    18,
    'No',
    12,
    5,
    'Yes',
    '',
  ],
];

export const PRODUCT_IMPORT_COLUMNS = [
  { labels: ['Product Type', 'Type'], field: 'productType', required: true },
  { labels: ['Product Code', 'Code'], field: 'code', optional: true },
  { labels: ['Product Category', 'Category'], field: 'productCategory', optional: true },
  { labels: ['Brand / Manufacturer', 'Brand'], field: 'brand', required: true },
  { labels: ['Model / Variant', 'Model/Variant/Name', 'Model', 'Variant'], field: 'model', required: true },
  { labels: ['Product Name', 'Name'], field: 'name', optional: true },
  { labels: ['Description', 'Product Description'], field: 'description', optional: true },
  {
    labels: ['UOM', 'Unit of Measure (UOM)', 'Select UOM', 'UOM Name', 'UOM Code'],
    field: 'uom',
    optional: true,
  },
  { labels: ['Units per Pack'], field: 'unitsPerPack', type: 'number', defaultValue: 1 },
  {
    labels: ['Default Purchase Cost', 'Purchase Cost', 'Standard Cost'],
    field: 'purchaseCost',
    type: 'number',
    defaultValue: 0,
  },
  {
    labels: ['Default GST (%)', 'GST / Tax (%)', 'GST / Tax', 'GST Rate', 'GST'],
    field: 'gstRate',
    type: 'number',
    defaultValue: 0,
  },
  { labels: ['Inventory Type'], field: 'inventoryType', optional: true },
  { labels: ['Expiry Applicable'], field: 'expiryApplicable', type: 'bool', defaultValue: false },
  { labels: ['Warranty (Months)', 'Warranty Months'], field: 'warrantyPeriodMonths', type: 'number', defaultValue: 0 },
  { labels: ['Reorder Level', 'Minimum Stock Level', 'Min Stock'], field: 'reorderLevel', type: 'number', defaultValue: 0 },
  { labels: ['Active'], field: 'isActive', type: 'bool', defaultValue: true },
  { labels: ['Remarks', 'Internal Remarks'], field: 'internalRemarks', optional: true },
];
