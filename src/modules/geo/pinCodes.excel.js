/** PIN Geography excel — sample/import: State, District, Pin Codes (comma-separated). */

/** Download/export and sample/import share the grouped district format. */
export const PIN_CODE_HEADERS = ['State', 'District', 'Pin Codes'];

export const PIN_CODE_IMPORT_HEADERS = PIN_CODE_HEADERS;

export const PIN_CODE_SAMPLE_ROWS = [
  [
    'Andhra Pradesh',
    'Alluri Sitharama Raju',
    '531024, 531025, 531026, 531027, 531028, 531029, 531030, 531031',
  ],
  [
    'Delhi',
    'New Delhi',
    '110001, 110002, 110003, 110011, 110012',
  ],
  [
    'Maharashtra',
    'Mumbai City',
    '400001, 400002, 400003',
  ],
];

export const PIN_CODE_IMPORT_ALIASES = {
  stateName: ['State', 'stateName'],
  districtName: ['District', 'District Name', 'districtName'],
  pinCodes: [
    'Pin Codes',
    'PIN Codes',
    'Pincodes',
    'Pin Code List',
    'PIN Code List',
    'pinCodes',
  ],
  /** Legacy one-PIN-per-row imports */
  pinCode: ['PIN Code', 'PIN', 'Pincode', 'pinCode'],
  zoneName: ['Zone', 'zoneName'],
  cityName: ['City', 'cityName'],
};

/** Split a Pin Codes cell into unique 6-digit PIN strings (order preserved). */
export function parsePinCodesCell(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  const seen = new Set();
  const out = [];
  for (const part of text.split(/[,;|/]+/)) {
    const pin = String(part || '').replace(/\D+/g, '');
    if (!/^\d{6}$/.test(pin) || seen.has(pin)) continue;
    seen.add(pin);
    out.push(pin);
  }
  return out;
}

/**
 * Expand one spreadsheet row into pin upsert payloads.
 * Supports grouped "Pin Codes" cells and legacy single "PIN Code" rows.
 */
export function expandPinGeographyImportRow(row = {}, { rowNum = 0, cellValue } = {}) {
  const read = typeof cellValue === 'function'
    ? (aliases) => cellValue(row, aliases)
    : (aliases) => {
      for (const key of aliases) {
        if (row[key] != null && String(row[key]).trim() !== '') return row[key];
      }
      return '';
    };

  const stateName = String(read(PIN_CODE_IMPORT_ALIASES.stateName) || '').trim();
  const districtName = String(read(PIN_CODE_IMPORT_ALIASES.districtName) || '').trim();
  const cityName = String(read(PIN_CODE_IMPORT_ALIASES.cityName) || '').trim();
  const locality = String(read(['Locality', 'locality']) || '').trim();
  const notes = String(read(['Notes', 'notes']) || '').trim();
  const activeRaw = read(['Active', 'Status', 'isActive']);
  const isActive = !['no', 'false', '0', 'inactive'].includes(String(activeRaw || '').toLowerCase());

  const grouped = parsePinCodesCell(read(PIN_CODE_IMPORT_ALIASES.pinCodes));
  const single = String(read(PIN_CODE_IMPORT_ALIASES.pinCode) || '').replace(/\D+/g, '');
  const pinCodes = grouped.length
    ? grouped
    : (/^\d{6}$/.test(single) ? [single] : []);

  return pinCodes.map((pinCode) => ({
    rowNum,
    pinCode,
    stateName,
    districtName,
    cityName,
    locality,
    notes,
    isActive,
  }));
}

/** Group pin records for sample/export round-trip (State, District, Pin Codes). */
export function pinsToGroupedExcelRows(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const state = String(row.stateName || '').trim();
    const district = String(row.districtName || '').trim();
    const pin = String(row.pinCode || '').replace(/\D+/g, '');
    if (!/^\d{6}$/.test(pin)) continue;
    const key = `${state.toLowerCase()}\0${district.toLowerCase()}`;
    let group = groups.get(key);
    if (!group) {
      group = { state, district, pins: [], seen: new Set() };
      groups.set(key, group);
    }
    if (group.seen.has(pin)) continue;
    group.seen.add(pin);
    group.pins.push(pin);
    if (!group.state && state) group.state = state;
    if (!group.district && district) group.district = district;
  }
  return [...groups.values()]
    .sort((a, b) => a.state.localeCompare(b.state) || a.district.localeCompare(b.district))
    .map((group) => [group.state, group.district, group.pins.join(', ')]);
}
