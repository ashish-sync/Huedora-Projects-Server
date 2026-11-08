/** Form Master categories for Public Camp Request and other reusable formats. */
export const FORM_CATEGORIES = [
  { id: 'PUBLIC_CAMP_REQUEST', label: 'Public Camp Request' },
  { id: 'INTERNAL', label: 'Internal' },
  { id: 'OTHER', label: 'Other' },
];

export const FORM_CATEGORY_IDS = FORM_CATEGORIES.map((row) => row.id);

export const FORM_FIELD_TYPES = [
  { id: 'text', label: 'Text' },
  { id: 'textarea', label: 'Long text' },
  { id: 'number', label: 'Number' },
  { id: 'date', label: 'Date' },
  { id: 'time', label: 'Time' },
  { id: 'phone', label: 'Phone' },
  { id: 'email', label: 'Email' },
  { id: 'select', label: 'Dropdown' },
];

export const FORM_FIELD_TYPE_IDS = FORM_FIELD_TYPES.map((row) => row.id);

/** Built-in starter format for Public Camp Request forms. */
export const PUBLIC_CAMP_REQUEST_TEMPLATE = {
  name: 'Public Camp Request',
  code: 'PUBLIC_CAMP_REQUEST',
  category: 'PUBLIC_CAMP_REQUEST',
  description: 'Default public camp request fields used for program request links.',
  fields: [
    { key: 'doctorName', label: 'Doctor Name', type: 'text', required: true, options: [] },
    { key: 'doctorCode', label: 'Doctor Code', type: 'text', required: true, options: [] },
    { key: 'speciality', label: 'Doctor Type / Specialty', type: 'text', required: false, options: [] },
    { key: 'campDate', label: 'Camp Date', type: 'date', required: true, options: [] },
    { key: 'startTime', label: 'Camp Start Time', type: 'time', required: true, options: [] },
    { key: 'endTime', label: 'Camp End Time', type: 'time', required: true, options: [] },
    { key: 'campAddress', label: 'Camp / Clinic Address', type: 'textarea', required: true, options: [] },
    { key: 'contactPersonLevel', label: 'Contact Person Level', type: 'text', required: true, options: [] },
    { key: 'fieldPersonName', label: 'Contact Person Name', type: 'text', required: true, options: [] },
    { key: 'fieldPersonPhone', label: 'Contact Person Number', type: 'phone', required: true, options: [] },
    { key: 'hq', label: 'HQ (Headquarter)', type: 'text', required: true, options: [] },
    { key: 'expectedPatients', label: 'Expected Patients', type: 'number', required: true, options: [] },
    { key: 'remarks', label: 'Remarks', type: 'textarea', required: false, options: [] },
  ],
};

export function matchFormCategory(raw) {
  const value = String(raw || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (FORM_CATEGORY_IDS.includes(value)) return value;
  if (/camp.?request|public/i.test(String(raw || ''))) return 'PUBLIC_CAMP_REQUEST';
  if (/internal/i.test(String(raw || ''))) return 'INTERNAL';
  return 'OTHER';
}

export function matchFormFieldType(raw) {
  const value = String(raw || 'text').trim().toLowerCase();
  if (FORM_FIELD_TYPE_IDS.includes(value)) return value;
  if (value === 'longtext' || value === 'long_text') return 'textarea';
  if (value === 'dropdown') return 'select';
  return 'text';
}
