import { CAMP_ZONE_DEFINITIONS, STATE_NAME_ALIASES } from './geo.zones.constants.js';

function normKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function canonicalStateName(stateName) {
  const raw = String(stateName ?? '').trim();
  if (!raw) return '';
  const key = normKey(raw);
  return STATE_NAME_ALIASES[key] || raw;
}

export function buildStateZoneLookup(zones = CAMP_ZONE_DEFINITIONS) {
  const byStateName = new Map();
  for (const zone of zones) {
    for (const stateName of zone.states || []) {
      byStateName.set(normKey(stateName), zone.name);
    }
  }
  return byStateName;
}

const defaultLookup = buildStateZoneLookup();

export function resolveZoneNameForState(stateName, lookup = defaultLookup) {
  const canonical = canonicalStateName(stateName);
  if (!canonical) return '';
  return lookup.get(normKey(canonical)) || '';
}

export function resolveZoneForStateRecord(stateName, zones = []) {
  const zoneName = resolveZoneNameForState(stateName);
  if (!zoneName) return null;
  const row = zones.find((z) => z.name === zoneName && z.isActive !== false && z.isDeleted !== true);
  if (!row) return { zone: zoneName, zoneId: '' };
  return { zone: row.name, zoneId: row._id };
}
