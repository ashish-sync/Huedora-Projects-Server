/**
 * Heal PIN rows whose districtId / cityId no longer align with geo masters.
 * - Orphan districtId (missing district) → remap from districtName / Delhi map
 * - City outside PIN district (legacy resolveCityForDistrict inState[0] bug) → re-resolve
 *
 * Streams PINs in batches — never loads the full India PIN master into RSS
 * (Render free ~512MB OOM on boot).
 */
import { GeoCity, GeoDistrict, GeoState } from './geo.model.js';
import { queryCollection, upsertDocument } from '../../store/persistence.js';
import { normGeoKey } from './geo.districtSupplements.js';
import delhiPinDistrictMap from './delhiPinDistrictMap.json' with { type: 'json' };
import { resolveCityForDistrict } from './pinCode.service.js';
import {
  buildDistrictAliasMap,
  buildDistrictCityFallbackMap,
  DISTRICT_SUPPLEMENTS_BY_STATE,
} from './geo.districtSupplements.js';

/** India Post / cleaned master districts for Delhi PINs (boot-time heal fallback). */
export const DELHI_PIN_DISTRICT_BY_CODE = delhiPinDistrictMap;

const PIN_BATCH = 400;

function districtKey(stateId, name) {
  return `${stateId}|${normGeoKey(name)}`;
}

function buildCityIndexes(states, districts, cities) {
  const districtAliasesByState = new Map();
  const districtCityFallbacksByState = new Map();
  for (const [stateKey, supplements] of Object.entries(DISTRICT_SUPPLEMENTS_BY_STATE)) {
    districtAliasesByState.set(stateKey, buildDistrictAliasMap(supplements));
    districtCityFallbacksByState.set(stateKey, buildDistrictCityFallbackMap(supplements));
  }

  const citiesByDistrict = new Map();
  const citiesByState = new Map();
  const cityByStateAndName = new Map();
  for (const city of cities) {
    if (city.isDeleted) continue;
    const districtId = String(city.districtId || '');
    if (districtId) {
      const list = citiesByDistrict.get(districtId) || [];
      list.push(city);
      citiesByDistrict.set(districtId, list);
    }
    const stateKey = String(city.stateId || '');
    const stateList = citiesByState.get(stateKey) || [];
    stateList.push(city);
    citiesByState.set(stateKey, stateList);
    cityByStateAndName.set(`${stateKey}|${normGeoKey(city.name)}`, city);
  }

  return {
    districtAliasesByState,
    districtCityFallbacksByState,
    citiesByDistrict,
    citiesByState,
    cityByStateAndName,
  };
}

/**
 * Remap active PIN rows with missing/orphan districtId or mismatched cityId.
 * Idempotent — safe to run on every boot.
 */
export async function healOrphanPinDistrictLinks() {
  const [districts, states, cities] = await Promise.all([
    GeoDistrict.find({ isDeleted: false }),
    GeoState.find({ isDeleted: false }),
    GeoCity.find({ isDeleted: false }),
  ]);

  const districtById = new Map(districts.map((d) => [String(d._id), d]));
  const districtByStateName = new Map();
  for (const d of districts) {
    districtByStateName.set(districtKey(d.stateId, d.name), d);
  }

  const stateById = new Map(states.map((s) => [String(s._id), s]));
  const stateByName = new Map(states.map((s) => [normGeoKey(s.name), s]));
  const delhiState = stateByName.get('delhi') || states.find((s) => String(s._id) === 'st_4021');
  const stateNameById = new Map(states.map((s) => [String(s._id), s.name]));
  const cityById = new Map(cities.map((c) => [String(c._id), c]));
  const cityIndexes = buildCityIndexes(states, districts, cities);

  let healed = 0;
  let cityHealed = 0;
  let skipped = 0;
  let checked = 0;
  let skip = 0;

  for (;;) {
    const { data: pins } = await queryCollection('geo_pin_codes', {
      filter: { isDeleted: false },
      skip,
      limit: PIN_BATCH,
    });
    if (!pins.length) break;

    for (const pin of pins) {
      checked += 1;
      const pinCode = String(pin.pinCode || '').replace(/\D+/g, '');
      let currentDistrict = districtById.get(String(pin.districtId || ''));
      let next = { ...pin };
      let changed = false;

      if (!currentDistrict) {
        let targetName = String(pin.districtName || '').trim();
        if (!targetName && DELHI_PIN_DISTRICT_BY_CODE[pinCode]) {
          targetName = DELHI_PIN_DISTRICT_BY_CODE[pinCode];
        }
        if (!targetName) {
          skipped += 1;
          continue;
        }

        const stateId = String(pin.stateId || delhiState?._id || '');
        let district = districtByStateName.get(districtKey(stateId, targetName));
        if (!district && stateId === String(delhiState?._id || '')) {
          district = districtByStateName.get(districtKey(stateId, `${targetName} Delhi`));
        }
        if (!district) {
          skipped += 1;
          continue;
        }

        next = {
          ...next,
          stateId: district.stateId || pin.stateId,
          districtId: district._id,
          districtName: district.name,
          stateName: stateNameById.get(String(district.stateId)) || pin.stateName || '',
        };
        currentDistrict = district;
        changed = true;
        healed += 1;
      }

      const state = stateById.get(String(next.stateId || currentDistrict.stateId || ''));
      const currentCity = cityById.get(String(next.cityId || ''));
      const cityDistrictId = String(currentCity?.districtId || '');
      const pinDistrictId = String(next.districtId || currentDistrict._id || '');
      const cityMismatch = Boolean(
        currentCity
        && cityDistrictId
        && pinDistrictId
        && cityDistrictId !== pinDistrictId
      );
      const cityMissing = Boolean(next.cityId) && !currentCity;

      if ((cityMismatch || cityMissing) && state && currentDistrict) {
        const resolvedCity = resolveCityForDistrict(
          {
            district: currentDistrict,
            state,
            districtInput: next.districtName || currentDistrict.name,
          },
          cityIndexes
        );
        const nextCityId = resolvedCity?._id || null;
        if (String(next.cityId || '') !== String(nextCityId || '')) {
          next = {
            ...next,
            cityId: nextCityId,
            cityName: resolvedCity?.name || '',
          };
          changed = true;
          cityHealed += 1;
        }
      }

      if (changed) {
        await upsertDocument('geo_pin_codes', {
          ...next,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    skip += pins.length;
    if (pins.length < PIN_BATCH) break;
  }

  return { healed, cityHealed, skipped, checked };
}
