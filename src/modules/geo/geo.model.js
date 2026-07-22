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

/**
 * PIN codes mapped to cities by administrators.
 * Starts empty — not imported from CSC postcodes.
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
