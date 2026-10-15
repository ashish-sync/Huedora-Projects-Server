import test from 'node:test';
import assert from 'node:assert/strict';
import {
  displayCityForPin,
  resolveCityForDistrict,
} from './pinCode.service.js';
import { PIN_CITY_OVERRIDES } from './pinCodeGeoNormalize.js';

function buildIndexes({ states, districts, cities }) {
  const citiesByDistrict = new Map();
  const citiesByState = new Map();
  const cityByStateAndName = new Map();
  for (const city of cities) {
    const districtKey = String(city.districtId || '');
    if (districtKey) {
      const list = citiesByDistrict.get(districtKey) || [];
      list.push(city);
      citiesByDistrict.set(districtKey, list);
    }
    const stateKey = String(city.stateId || '');
    const stateList = citiesByState.get(stateKey) || [];
    stateList.push(city);
    citiesByState.set(stateKey, stateList);
    cityByStateAndName.set(`${stateKey}|${String(city.name).toLowerCase()}`, city);
  }
  return {
    districtCityFallbacksByState: new Map(),
    citiesByDistrict,
    citiesByState,
    cityByStateAndName,
  };
}

test('resolveCityForDistrict: Mumbai Suburban maps to Mumbai — not first-in-state Ahmednagar', () => {
  const state = { _id: 'st_mh', name: 'Maharashtra' };
  const suburban = { _id: 'd_suburban', stateId: state._id, name: 'Mumbai Suburban' };
  const mumbaiCityDist = { _id: 'd_mumbai_city', stateId: state._id, name: 'Mumbai City' };
  const ahmednagarDist = { _id: 'd_ahmednagar', stateId: state._id, name: 'Ahmednagar' };

  const ahmednagar = {
    _id: 'c_ahmednagar',
    name: 'Ahmednagar',
    stateId: state._id,
    districtId: ahmednagarDist._id,
  };
  const mumbai = {
    _id: 'c_mumbai',
    name: 'Mumbai',
    stateId: state._id,
    districtId: mumbaiCityDist._id,
  };

  // CitiesByState insertion order puts Ahmednagar first (legacy bug path).
  const indexes = buildIndexes({
    states: [state],
    districts: [suburban, mumbaiCityDist, ahmednagarDist],
    cities: [ahmednagar, mumbai],
  });

  const resolved = resolveCityForDistrict(
    { district: suburban, state, districtInput: 'Mumbai Suburban' },
    indexes
  );

  assert.equal(resolved?._id, mumbai._id);
  assert.notEqual(resolved?._id, ahmednagar._id);
  assert.equal(PIN_CITY_OVERRIDES['maharashtra|mumbai suburban'], 'Mumbai');
});

test('resolveCityForDistrict: empty district without override returns null (never Ahmednagar)', () => {
  const state = { _id: 'st_mh', name: 'Maharashtra' };
  const bhandara = { _id: 'd_bhandara', stateId: state._id, name: 'Bhandara' };
  const ahmednagar = {
    _id: 'c_ahmednagar',
    name: 'Ahmednagar',
    stateId: state._id,
    districtId: 'd_ahmednagar',
  };
  const indexes = buildIndexes({
    states: [state],
    districts: [bhandara],
    cities: [ahmednagar],
  });

  const resolved = resolveCityForDistrict(
    { district: bhandara, state, districtInput: 'Bhandara' },
    indexes
  );
  assert.equal(resolved, null);
});

test('displayCityForPin: prefers district when cityId is outside PIN district (400072 case)', () => {
  const maps = {
    districts: {
      d_suburban: { _id: 'd_suburban', name: 'Mumbai Suburban' },
    },
    cities: {
      c_ahmednagar: {
        _id: 'c_ahmednagar',
        name: 'Ahmednagar',
        districtId: 'd_ahmednagar',
      },
    },
  };
  const label = displayCityForPin(
    { districtId: 'd_suburban', cityId: 'c_ahmednagar', districtName: 'Mumbai Suburban' },
    maps
  );
  assert.equal(label, 'Mumbai Suburban');
});

test('displayCityForPin: keeps city name when city belongs to PIN district', () => {
  const maps = {
    districts: {
      d_pune: { _id: 'd_pune', name: 'Pune' },
    },
    cities: {
      c_pune: { _id: 'c_pune', name: 'Pune', districtId: 'd_pune' },
    },
  };
  const label = displayCityForPin({ districtId: 'd_pune', cityId: 'c_pune' }, maps);
  assert.equal(label, 'Pune');
});
