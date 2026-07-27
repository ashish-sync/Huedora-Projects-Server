import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

/** Indian states / UTs (dr5hn CSC). */
export const GeoState = defineCollection('geo_states', {
  ...softDelete,
  cscId: null,
  name: '',
  iso2: '',
  type: 'state',
  latitude: null,
  longitude: null,
  countryCode: 'IN',
  isActive: true,
  source: '',
});

/** Districts under a state (open India district list; CSC has no district layer). */
export const GeoDistrict = defineCollection('geo_districts', {
  ...softDelete,
  stateId: null,
  stateName: '',
  name: '',
  isActive: true,
  source: '',
});

/** Cities / towns under a state (optional district link). */
export const GeoCity = defineCollection('geo_cities', {
  ...softDelete,
  cscId: null,
  stateId: null,
  stateName: '',
  districtId: null,
  name: '',
  latitude: null,
  longitude: null,
  timezone: 'Asia/Kolkata',
  isActive: true,
  source: '',
});

/** Camp / operations zones mapped to Indian states (seeded master). */
export const GeoZone = defineCollection('geo_zones', {
  ...softDelete,
  code: '',
  name: '',
  sortOrder: 0,
  states: [],
  isActive: true,
});

/**
 * PIN codes mapped to state / district / city masters (one row per PIN).
 * Names are resolved from geo masters at read time; only foreign keys are stored.
 */
export const GeoPinCode = defineCollection('geo_pin_codes', {
  ...softDelete,
  pinCode: '',
  cityId: null,
  cityName: '',
  districtId: null,
  districtName: '',
  stateId: null,
  stateName: '',
  locality: '',
  isActive: true,
  notes: '',
  createdBy: null,
  updatedBy: null,
});
