/**
 * Heal PIN rows whose districtId no longer exists in geo_districts.
 * Delhi PIN rows were left with orphan IDs after district master refresh.
 */
import { GeoDistrict, GeoPinCode, GeoState } from './geo.model.js';
import { bulkUpsertDocuments } from '../../store/persistence.js';
import { normGeoKey } from './geo.districtSupplements.js';
import delhiPinDistrictMap from './delhiPinDistrictMap.json' with { type: 'json' };

/** India Post / cleaned master districts for Delhi PINs (boot-time heal fallback). */
export const DELHI_PIN_DISTRICT_BY_CODE = delhiPinDistrictMap;

function districtKey(stateId, name) {
  return `${stateId}|${normGeoKey(name)}`;
}

/**
 * Remap active PIN rows with missing/orphan districtId to a live district.
 * Idempotent — safe to run on every boot.
 */
export async function healOrphanPinDistrictLinks() {
  const [pins, districts, states] = await Promise.all([
    GeoPinCode.find({ isDeleted: false }),
    GeoDistrict.find({ isDeleted: false }),
    GeoState.find({ isDeleted: false }),
  ]);

  const districtById = new Map(districts.map((d) => [String(d._id), d]));
  const districtByStateName = new Map();
  for (const d of districts) {
    districtByStateName.set(districtKey(d.stateId, d.name), d);
  }

  const stateByName = new Map(states.map((s) => [normGeoKey(s.name), s]));
  const delhiState = stateByName.get('delhi') || states.find((s) => String(s._id) === 'st_4021');

  const touched = [];
  let healed = 0;
  let skipped = 0;

  for (const pin of pins) {
    const pinCode = String(pin.pinCode || '').replace(/\D+/g, '');
    const currentDistrict = districtById.get(String(pin.districtId || ''));
    if (currentDistrict) continue;

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

    const next = {
      ...pin,
      stateId: district.stateId || pin.stateId,
      districtId: district._id,
      districtName: district.name,
      stateName: states.find((s) => String(s._id) === String(district.stateId))?.name || pin.stateName || '',
      updatedAt: new Date().toISOString(),
    };
    touched.push(next);
    healed += 1;
  }

  if (touched.length) {
    await bulkUpsertDocuments('geo_pin_codes', touched);
  }

  return { healed, skipped, checked: pins.length };
}
