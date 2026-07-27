/** Signature master excel columns — sample matches Signature Master form (typed import). */

export const SIGNATURE_SAMPLE_HEADERS = [
  'Person name',
  'Role / designation',
  'Email',
  'Department',
  'Typed signature',
  'Notes',
];

export const SIGNATURE_EXPORT_HEADERS = [...SIGNATURE_SAMPLE_HEADERS, 'Active'];

export const SIGNATURE_HEADERS = SIGNATURE_SAMPLE_HEADERS;

export const SIGNATURE_SAMPLE_ROWS = [
  [
    'Priya Sharma',
    'HR',
    'priya@example.com',
    'Human Resources',
    'Priya Sharma',
    'Sample typed signature',
  ],
];
