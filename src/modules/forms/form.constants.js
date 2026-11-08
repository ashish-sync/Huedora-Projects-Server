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
  { id: 'currency', label: 'Currency' },
  { id: 'date', label: 'Date' },
  { id: 'time', label: 'Time' },
  { id: 'phone', label: 'Phone' },
  { id: 'email', label: 'Email' },
  { id: 'url', label: 'URL' },
  { id: 'select', label: 'Dropdown' },
  { id: 'radio', label: 'Radio' },
  { id: 'checkbox', label: 'Checkbox' },
  { id: 'checkbox_group', label: 'Checkbox group' },
  { id: 'image', label: 'Image' },
  { id: 'gps_photo', label: 'GPS Photo' },
  { id: 'file', label: 'File (PDF, Excel, etc.)' },
];

export const FORM_FIELD_TYPE_IDS = FORM_FIELD_TYPES.map((row) => row.id);

export const FORM_FIELD_WIDTHS = [
  { id: 'half', label: 'Half width' },
  { id: 'full', label: 'Full width' },
];

export const FORM_FIELD_WIDTH_IDS = FORM_FIELD_WIDTHS.map((row) => row.id);

export const FORM_FIELD_FORMATS = [
  { id: '', label: 'None' },
  { id: 'uppercase', label: 'Uppercase' },
  { id: 'lowercase', label: 'Lowercase' },
  { id: 'titlecase', label: 'Title case' },
  { id: 'digits', label: 'Digits only' },
  { id: 'phone-in', label: 'India phone' },
  { id: 'email', label: 'Email' },
  { id: 'url', label: 'URL' },
  { id: 'date-iso', label: 'Date (ISO)' },
  { id: 'time-24h', label: 'Time (24h)' },
];

export const FORM_FIELD_FORMAT_IDS = FORM_FIELD_FORMATS.map((row) => row.id).filter(Boolean);

export const FORM_SHOW_OPERATORS = [
  { id: 'eq', label: 'Equals' },
  { id: 'neq', label: 'Does not equal' },
  { id: 'in', label: 'Is one of' },
  { id: 'contains', label: 'Contains' },
  { id: 'empty', label: 'Is empty' },
  { id: 'notEmpty', label: 'Is not empty' },
];

export const FORM_SHOW_OPERATOR_IDS = FORM_SHOW_OPERATORS.map((row) => row.id);

/** Built-in starter format for Public Camp Request forms. */
export const PUBLIC_CAMP_REQUEST_TEMPLATE = {
  name: 'Public Camp Request',
  code: 'PUBLIC_CAMP_REQUEST',
  category: 'PUBLIC_CAMP_REQUEST',
  description: 'Default public camp request fields used for program request links.',
  fields: [
    {
      key: 'doctorName',
      label: 'Doctor Name',
      type: 'text',
      required: true,
      section: 'Doctor',
      width: 'half',
      options: [],
    },
    {
      key: 'doctorCode',
      label: 'Doctor Code',
      type: 'text',
      required: true,
      section: 'Doctor',
      width: 'half',
      format: 'uppercase',
      options: [],
    },
    {
      key: 'speciality',
      label: 'Doctor Type / Specialty',
      type: 'text',
      required: false,
      section: 'Doctor',
      width: 'full',
      options: [],
    },
    {
      key: 'campDate',
      label: 'Camp Date',
      type: 'date',
      required: true,
      section: 'Schedule',
      width: 'half',
      format: 'date-iso',
      options: [],
    },
    {
      key: 'startTime',
      label: 'Camp Start Time',
      type: 'time',
      required: true,
      section: 'Schedule',
      width: 'half',
      format: 'time-24h',
      options: [],
    },
    {
      key: 'endTime',
      label: 'Camp End Time',
      type: 'time',
      required: true,
      section: 'Schedule',
      width: 'half',
      format: 'time-24h',
      options: [],
    },
    {
      key: 'campAddress',
      label: 'Camp / Clinic Address',
      type: 'textarea',
      required: true,
      section: 'Location',
      width: 'full',
      options: [],
    },
    {
      key: 'hq',
      label: 'HQ (Headquarter)',
      type: 'text',
      required: true,
      section: 'Location',
      width: 'half',
      options: [],
    },
    {
      key: 'contactPersonLevel',
      label: 'Contact Person Level',
      type: 'text',
      required: true,
      section: 'Contact',
      width: 'half',
      options: [],
    },
    {
      key: 'fieldPersonName',
      label: 'Contact Person Name',
      type: 'text',
      required: true,
      section: 'Contact',
      width: 'half',
      options: [],
    },
    {
      key: 'fieldPersonPhone',
      label: 'Contact Person Number',
      type: 'phone',
      required: true,
      section: 'Contact',
      width: 'half',
      format: 'phone-in',
      options: [],
    },
    {
      key: 'expectedPatients',
      label: 'Expected Patients',
      type: 'number',
      required: true,
      section: 'Demand',
      width: 'half',
      min: 1,
      options: [],
    },
    {
      key: 'remarks',
      label: 'Remarks',
      type: 'textarea',
      required: false,
      section: 'Demand',
      width: 'full',
      options: [],
    },
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
  const value = String(raw || 'text').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (FORM_FIELD_TYPE_IDS.includes(value)) return value;
  if (value === 'longtext' || value === 'long_text') return 'textarea';
  if (value === 'dropdown') return 'select';
  if (value === 'checkboxes' || value === 'multi_checkbox') return 'checkbox_group';
  if (value === 'money' || value === 'amount') return 'currency';
  if (value === 'photo' || value === 'picture' || value === 'img') return 'image';
  if (value === 'gps' || value === 'gpsphoto' || value === 'geotagged_photo' || value === 'geo_photo') {
    return 'gps_photo';
  }
  if (value === 'attachment' || value === 'document' || value === 'upload' || value === 'pdf') {
    return 'file';
  }
  return 'text';
}

export function matchFormFieldWidth(raw) {
  const value = String(raw || 'half').trim().toLowerCase();
  if (FORM_FIELD_WIDTH_IDS.includes(value)) return value;
  if (value === '1' || value === 'span2' || value === 'wide') return 'full';
  return 'half';
}

export function matchFormFieldFormat(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return '';
  if (FORM_FIELD_FORMAT_IDS.includes(value)) return value;
  return '';
}

export function matchFormShowOperator(raw) {
  const value = String(raw || 'eq').trim();
  if (FORM_SHOW_OPERATOR_IDS.includes(value)) return value;
  return 'eq';
}
