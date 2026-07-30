/**
 * Replace all cities in india-geo.json from city-master.json.
 * States and districts are preserved; PIN codes are untouched at runtime (geo:reseed).
 *
 * Usage: node scripts/buildTyloCitySeed.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cityMasterPath = path.resolve(__dirname, '../src/modules/geo/seed/city-master.json');
const seedPath = path.resolve(__dirname, '../src/modules/geo/seed/india-geo.json');

const STATE_ALIASES = {
  'jammu kashmir': 'Jammu and Kashmir',
  'jammu & kashmir': 'Jammu and Kashmir',
};

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slug(name) {
  return norm(name).replace(/\s+/g, '_');
}

function resolveStateName(stateName, stateByNorm) {
  const aliasTarget = STATE_ALIASES[norm(stateName)];
  if (aliasTarget && stateByNorm.has(norm(aliasTarget))) return aliasTarget;
  const state = stateByNorm.get(norm(stateName));
  if (!state) throw new Error(`Unknown state in city master: ${stateName}`);
  return state.name;
}

function buildCitiesFromMaster(cityMaster, states, districts) {
  const stateByNorm = new Map(states.map((state) => [norm(state.name), state]));
  const districtsByState = new Map();

  for (const district of districts) {
    const list = districtsByState.get(district.stateId) || [];
    list.push(district);
    districtsByState.set(district.stateId, list);
  }

  const seen = new Set();
  const cities = [];

  for (const row of cityMaster) {
    const stateName = resolveStateName(row.stateName, stateByNorm);
    const state = stateByNorm.get(norm(stateName));
    const cityKey = `${state._id}:${norm(row.name)}`;
    if (seen.has(cityKey)) continue;
    seen.add(cityKey);

    let districtId = null;
    const cityNorm = norm(row.name);
    for (const district of districtsByState.get(state._id) || []) {
      const districtNorm = norm(district.name);
      if (
        cityNorm === districtNorm
        || (districtNorm.length >= 4 && (cityNorm.startsWith(districtNorm) || districtNorm.startsWith(cityNorm)))
      ) {
        districtId = district._id;
        break;
      }
    }

    cities.push({
      _id: `${state._id}_c_${slug(row.name)}`,
      cscId: null,
      stateId: state._id,
      stateName: state.name,
      districtId,
      name: row.name,
      latitude: null,
      longitude: null,
      timezone: 'Asia/Kolkata',
      isActive: true,
      isDeleted: false,
      source: 'tylo-city-master',
    });
  }

  cities.sort((a, b) => {
    const stateCmp = a.stateName.localeCompare(b.stateName);
    return stateCmp !== 0 ? stateCmp : a.name.localeCompare(b.name);
  });

  return cities;
}

function main() {
  const cityMaster = JSON.parse(fs.readFileSync(cityMasterPath, 'utf8'));
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const cities = buildCitiesFromMaster(cityMaster, seed.states, seed.districts);
  const matched = cities.filter((city) => city.districtId).length;

  seed.cities = cities;
  seed.meta = {
    ...seed.meta,
    sourcedAt: new Date().toISOString(),
    sources: [
      'sab99r/Indian-States-And-Districts (districts)',
      'tylo-city-master (operational state-wise city list)',
    ],
    counts: {
      ...seed.meta.counts,
      cities: cities.length,
      citiesMatchedToDistrict: matched,
      citiesUnassigned: cities.length - matched,
    },
  };

  fs.writeFileSync(seedPath, JSON.stringify(seed));
  console.log('Wrote', seedPath);
  console.log(seed.meta.counts);
}

main();
