/**
 * Extra districts missing from the bundled India geo seed (mostly UTs).
 * India Post PIN data uses these names — especially Delhi revenue districts.
 */

export const DELHI_DISTRICT_SUPPLEMENTS = [
  { name: 'Central Delhi', aliases: ['Central'] },
  { name: 'East Delhi', aliases: ['East'] },
  { name: 'New Delhi', aliases: [] },
  { name: 'North Delhi', aliases: ['North'] },
  { name: 'North East Delhi', aliases: ['North East'] },
  { name: 'North West Delhi', aliases: ['North West'] },
  { name: 'Shahdara', aliases: [], cityFallback: 'East Delhi' },
  { name: 'South Delhi', aliases: ['South'] },
  { name: 'South East Delhi', aliases: ['South East'], cityFallback: 'South Delhi' },
  { name: 'South West Delhi', aliases: ['South West'] },
  { name: 'West Delhi', aliases: ['West'] },
];

export const CHANDIGARH_DISTRICT_SUPPLEMENTS = [
  { name: 'Chandigarh', aliases: [] },
];

export const PUDUCHERRY_DISTRICT_SUPPLEMENTS = [
  { name: 'Puducherry', aliases: ['Pondicherry'], cityFallback: 'Puducherry' },
  { name: 'Karaikal', aliases: [], cityFallback: 'Karaikal' },
  { name: 'Mahe', aliases: [], cityFallback: 'Mahe' },
];

/** State name (normalized) → district supplements */
export const DISTRICT_SUPPLEMENTS_BY_STATE = {
  delhi: DELHI_DISTRICT_SUPPLEMENTS,
  chandigarh: CHANDIGARH_DISTRICT_SUPPLEMENTS,
  puducherry: PUDUCHERRY_DISTRICT_SUPPLEMENTS,
};

export function buildDistrictAliasMap(supplements = []) {
  const aliases = new Map();
  for (const entry of supplements) {
    aliases.set(normGeoKey(entry.name), entry.name);
    for (const alias of entry.aliases || []) {
      aliases.set(normGeoKey(alias), entry.name);
    }
  }
  return aliases;
}

export function buildDistrictCityFallbackMap(supplements = []) {
  const fallbacks = new Map();
  for (const entry of supplements) {
    if (entry.cityFallback) {
      fallbacks.set(normGeoKey(entry.name), entry.cityFallback);
      for (const alias of entry.aliases || []) {
        fallbacks.set(normGeoKey(alias), entry.cityFallback);
      }
    }
  }
  return fallbacks;
}

export function normGeoKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
