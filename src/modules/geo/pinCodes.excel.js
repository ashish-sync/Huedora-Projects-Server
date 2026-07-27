/** PIN Geography excel columns — aligned with Master One form (PIN Code, State, Zone, District). */

export const PIN_CODE_HEADERS = ['PIN Code', 'State', 'Zone', 'District'];

/** Sample and export use the same columns so the downloaded template matches the master form. */
export const PIN_CODE_IMPORT_HEADERS = PIN_CODE_HEADERS;

export const PIN_CODE_SAMPLE_ROWS = [
  ['110001', 'Delhi', 'North Zone', 'New Delhi'],
  ['400001', 'Maharashtra', 'West Zone', 'Mumbai City'],
  ['500081', 'Telangana', 'South Zone', 'Hyderabad'],
];

export const PIN_CODE_IMPORT_ALIASES = {
  pinCode: ['PIN Code', 'PIN', 'Pincode', 'pinCode'],
  stateName: ['State', 'stateName'],
  zoneName: ['Zone', 'zoneName'],
  districtName: ['District', 'District Name', 'districtName'],
};
