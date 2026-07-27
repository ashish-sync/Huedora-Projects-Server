/** PIN Geography excel columns — State + District import; Zone is derived from State on export. */

export const PIN_CODE_IMPORT_HEADERS = ['PIN Code', 'State', 'District'];

export const PIN_CODE_HEADERS = ['PIN Code', 'State', 'Zone', 'District'];

export const PIN_CODE_SAMPLE_ROWS = [
  ['110001', 'Delhi', 'New Delhi'],
  ['400001', 'Maharashtra', 'Mumbai City'],
  ['500081', 'Telangana', 'Hyderabad'],
];

export const PIN_CODE_IMPORT_ALIASES = {
  pinCode: ['PIN Code', 'PIN', 'pinCode'],
  stateName: ['State', 'stateName'],
  districtName: ['District', 'districtName'],
};
