import { GeoPinCode } from '../geo/geo.model.js';
import { enrichPinRecord } from '../geo/pinCode.service.js';
import { resolveZoneNameForState } from '../geo/geo.zones.js';
import { trimStr } from './campOps.helpers.js';
import { NOT_PROVIDED } from './manualPaste.extract.js';

function withDefault(value) {
  const v = trimStr(value);
  return v || NOT_PROVIDED;
}

export async function enrichPasteLocationFromPin(row = {}, display = {}) {
  const pin = String(row.pincode || '').replace(/\D/g, '').slice(0, 6);
  if (pin.length !== 6) {
    const zone = row.state ? resolveZoneNameForState(row.state) : '';
    if (zone) {
      return {
        row: { ...row, zone },
        display: { ...display, zone: withDefault(zone) },
        locationSource: row.state ? 'state-zone' : '',
      };
    }
    return { row, display, locationSource: '' };
  }

  const matches = await GeoPinCode.find({
    pinCode: pin,
    isDeleted: false,
    isActive: true,
  });

  if (!matches.length) {
    const zone = row.state ? resolveZoneNameForState(row.state) : '';
    return {
      row: { ...row, pincode: pin, zone: zone || row.zone || '' },
      display: {
        ...display,
        pincode: withDefault(pin),
        zone: withDefault(zone || display.zone),
      },
      locationSource: 'address-parsed',
    };
  }

  const match = matches[0];
  const enriched = await enrichPinRecord(match);
  const city = trimStr(enriched.cityName) || row.city;
  const state = trimStr(enriched.stateName) || row.state;
  const district = trimStr(enriched.districtName) || row.district;
  const zone = resolveZoneNameForState(state) || '';

  const nextRow = {
    ...row,
    pincode: pin,
    city: district || city,
    state,
    district,
    hq: row.hq || district || city,
    zone,
  };

  const nextDisplay = {
    ...display,
    pincode: withDefault(pin),
    city: withDefault(district || city),
    state: withDefault(state),
    district: withDefault(district),
    hq: withDefault(row.hq || district || city),
    zone: withDefault(zone),
  };

  return {
    row: nextRow,
    display: nextDisplay,
    locationSource: 'pin-master',
  };
}
