/** PIN Geography excel columns — aligned with PIN master form (4 fields only). */

export const PIN_CODE_HEADERS = ['PIN Code', 'State', 'District', 'City'];

export const PIN_CODE_SAMPLE_ROWS = [
  ['400001', 'Maharashtra', 'Mumbai City', 'Mumbai'],
  ['500081', 'Telangana', 'Hyderabad', 'Hyderabad'],
];

export const PIN_CODE_IMPORT_ALIASES = {
  pinCode: ['PIN Code', 'PIN', 'pinCode'],
  stateName: ['State', 'stateName'],
  districtName: ['District', 'districtName'],
  cityName: ['City', 'cityName'],
};
