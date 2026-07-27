/** PIN Geography excel columns — aligned with Location Master form labels. */

export const PIN_CODE_HEADERS = [
  'PIN Code',
  'State',
  'City',
  'Locality',
  'Notes',
  'Status',
];

export const PIN_CODE_SAMPLE_ROWS = [
  ['400001', 'Maharashtra', 'Mumbai', 'Fort', 'Sample mapping', 'Active'],
  ['500081', 'Telangana', 'Hyderabad', 'Madhapur', '', 'Active'],
];

export const PIN_CODE_IMPORT_ALIASES = {
  pinCode: ['PIN Code', 'PIN', 'pinCode'],
  stateName: ['State', 'stateName'],
  districtName: ['District', 'districtName'],
  cityName: ['City', 'cityName'],
  locality: ['Locality', 'locality'],
  notes: ['Notes', 'notes'],
  isActive: ['Status', 'Active', 'isActive'],
};
