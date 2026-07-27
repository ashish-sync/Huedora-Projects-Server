/** Suppliers & Vendors excel columns — sample matches Master One party form. */

export const PARTY_SAMPLE_HEADERS = [
  'Type',
  'Name',
  'Contact name',
  'Email',
  'Phone',
  'City',
  'State',
  'GSTIN',
  'PAN Card',
];

export const PARTY_EXPORT_HEADERS = [...PARTY_SAMPLE_HEADERS, 'Active'];

export const PARTY_HEADERS = PARTY_EXPORT_HEADERS;

export const PARTY_SAMPLE_ROWS = [
  [
    'Supplier',
    'Acme Medical Supplies',
    'Raj Patel',
    'raj@acme.example',
    '9876543210',
    'Mumbai',
    'Maharashtra',
    '27AAAAA0000A1Z5',
    'ABCDE1234F',
  ],
  [
    'Vendor',
    'City Diagnostics',
    'Priya Shah',
    'vendor@citydiag.example',
    '9123456780',
    'Pune',
    'Maharashtra',
    '',
    '',
  ],
];

export const PARTY_IMPORT_COLUMNS = [
  { labels: ['Type', 'Party Type'], field: 'partyType' },
  { labels: ['Name'], field: 'name', required: true },
  { labels: ['Contact name', 'Contact Name', 'Contact'], field: 'contactName', optional: true },
  { labels: ['Email'], field: 'email', optional: true },
  { labels: ['Phone', 'Contact Number'], field: 'phone', optional: true },
  { labels: ['City'], field: 'city', optional: true },
  { labels: ['State'], field: 'state', optional: true },
  { labels: ['GSTIN'], field: 'gstin', optional: true },
  { labels: ['PAN Card', 'PAN'], field: 'panCard', optional: true },
  { labels: ['Active'], field: 'isActive', type: 'bool', defaultValue: true },
];
