/** Suppliers & Vendors excel columns — sample matches Master One party form. */

export const PARTY_SAMPLE_HEADERS = [
  'Type',
  'Name',
  'Contact name',
  'Email',
  'Phone',
  'City',
  'State',
  'PIN Code',
  'State Code',
  'Address',
  'Supply Category',
  'GSTIN',
  'PAN Card',
  'IFSC Code',
  'Bank Name',
  'Account Number',
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
    '400001',
    '27',
    '12 Fort Road, Mumbai',
    'Medical Consumables',
    '27AAAAA0000A1Z5',
    'ABCDE1234F',
    '',
    '',
    '',
  ],
  [
    'Vendor',
    'City Diagnostics',
    'Priya Shah',
    'vendor@citydiag.example',
    '9123456780',
    'Pune',
    'Maharashtra',
    '411001',
    '27',
    '',
    'Medical Devices',
    '',
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
  { labels: ['PIN Code', 'PIN', 'Pin Code'], field: 'pinCode', optional: true },
  { labels: ['State Code', 'StateCode'], field: 'stateCode', optional: true },
  { labels: ['Address', 'Billing Address'], field: 'address', optional: true },
  { labels: ['Supply Category', 'SupplyCategory'], field: 'supplyCategory', optional: true },
  { labels: ['GSTIN'], field: 'gstin', optional: true },
  { labels: ['PAN Card', 'PAN'], field: 'panCard', optional: true },
  { labels: ['IFSC Code', 'IFSC'], field: 'ifscCode', optional: true },
  { labels: ['Bank Name', 'Bank'], field: 'bankName', optional: true },
  { labels: ['Account Number', 'Account No', 'A/C'], field: 'accountNumber', optional: true },
];
