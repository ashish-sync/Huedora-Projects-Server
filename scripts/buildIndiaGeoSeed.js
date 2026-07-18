/**
 * Rebuild India geography seed from downloaded CSC exports.
 *
 * Prerequisites (in server/data/geo-import/):
 *   - csc-combo.json.gz  (dr5hn json-countries+states+cities)
 *   - india-districts.json (open India states/districts list)
 *
 * Usage: node scripts/buildIndiaGeoSeed.js
 */
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const importDir = path.resolve(__dirname, '../data/geo-import');
const outPath = path.resolve(__dirname, '../src/modules/geo/seed/india-geo.json');

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STATE_ALIASES = {
  orissa: 'odisha',
  pondicherry: 'puducherry',
  'nct of delhi': 'delhi',
  'delhi ncr': 'delhi',
  'dadra and nagar haveli': 'dadra and nagar haveli and daman and diu',
  'daman and diu': 'dadra and nagar haveli and daman and diu',
  'andaman nicobar': 'andaman and nicobar islands',
  'andaman and nicobar': 'andaman and nicobar islands',
  'jammu & kashmir': 'jammu and kashmir',
};

function stateKey(name) {
  const k = norm(name);
  return STATE_ALIASES[k] || k;
}

const combo = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(importDir, 'csc-combo.json.gz'))));
const india = combo.find((c) => c.iso2 === 'IN');
if (!india) throw new Error('India not found in CSC export');

const districtsFile = JSON.parse(fs.readFileSync(path.join(importDir, 'india-districts.json'), 'utf8'));
const districtByState = new Map();
for (const row of districtsFile.states || []) {
  districtByState.set(stateKey(row.state), (row.districts || []).map(String));
}

const states = [];
const districts = [];
const cities = [];
let matched = 0;
let unmatched = 0;

for (const st of india.states || []) {
  const stateId = `st_${st.id}`;
  const sKey = stateKey(st.name);
  states.push({
    _id: stateId,
    cscId: st.id,
    name: st.name,
    iso2: st.iso2 || '',
    type: st.type || 'state',
    latitude: st.latitude || null,
    longitude: st.longitude || null,
    countryCode: 'IN',
    isActive: true,
    isDeleted: false,
    source: 'dr5hn/countries-states-cities-database',
  });

  const districtIdByKey = new Map();
  for (const dName of districtByState.get(sKey) || []) {
    const dKey = norm(dName);
    const districtId = `${stateId}_d_${dKey.replace(/\s+/g, '_')}`;
    districtIdByKey.set(dKey, districtId);
    districts.push({
      _id: districtId,
      stateId,
      stateName: st.name,
      name: dName,
      isActive: true,
      isDeleted: false,
      source: 'indian-states-and-districts',
    });
  }

  for (const city of st.cities || []) {
    const cKey = norm(city.name);
    let districtId = districtIdByKey.get(cKey) || null;
    if (!districtId) {
      for (const [dKey, id] of districtIdByKey) {
        if (cKey === dKey || (dKey.length >= 4 && (cKey.startsWith(dKey) || dKey.startsWith(cKey)))) {
          districtId = id;
          break;
        }
      }
    }
    if (districtId) matched += 1;
    else unmatched += 1;
    cities.push({
      _id: `ct_${city.id}`,
      cscId: city.id,
      stateId,
      stateName: st.name,
      districtId,
      name: city.name,
      latitude: city.latitude || null,
      longitude: city.longitude || null,
      timezone: city.timezone || 'Asia/Kolkata',
      isActive: true,
      isDeleted: false,
      source: 'dr5hn/countries-states-cities-database',
    });
  }
}

const payload = {
  meta: {
    country: 'IN',
    countryName: 'India',
    sourcedAt: new Date().toISOString(),
    sources: [
      'dr5hn/countries-states-cities-database (states + cities)',
      'sab99r/Indian-States-And-Districts (districts; CSC has no district layer)',
    ],
    counts: {
      states: states.length,
      districts: districts.length,
      cities: cities.length,
      citiesMatchedToDistrict: matched,
      citiesUnassigned: unmatched,
    },
  },
  states,
  districts,
  cities,
  pinCodes: [],
};

fs.writeFileSync(outPath, JSON.stringify(payload));
console.log('Wrote', outPath);
console.log(payload.meta.counts);
