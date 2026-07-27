/** PIN Geography excel columns — aligned with docs/Pin Code Master.xlsx */

export const PIN_CODE_HEADERS = [
  'PIN Code',
  'State',
  'District',
  'City',
  'Locality',
  'Notes',
  'Active',
];

export const PIN_CODE_SAMPLE_ROWS = [
  ['110001', 'Delhi', 'New Delhi', 'New Delhi', '-', '', 'Yes'],
  ['400001', 'Maharashtra', 'Mumbai City', 'Mumbai', 'Fort', '', 'Yes'],
  ['500081', 'Telangana', 'Hyderabad', 'Hyderabad', '', '', 'Yes'],
];

export const PIN_CODE_IMPORT_ALIASES = {
  pinCode: ['PIN Code', 'PIN', 'pinCode'],
  stateName: ['State', 'stateName'],
  districtName: ['District', 'districtName'],
  cityName: ['City', 'cityName'],
  locality: ['Locality', 'locality'],
  notes: ['Notes', 'notes'],
  isActive: ['Active', 'Status', 'isActive'],
};
