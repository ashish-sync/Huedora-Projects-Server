/**
 * Heal PIN rows whose districtId no longer exists in geo_districts.
 * Delhi PIN rows were left with orphan IDs after district master refresh.
 *
 * Streams PINs in batches — never loads the full India PIN master into RSS
 * (Render free ~512MB OOM on boot).
 */
import { GeoDistrict, GeoState } from './geo.model.js';
import { queryCollection, upsertDocument } from '../../store/persistence.js';
import { normGeoKey } from './geo.districtSupplements.js';
import delhiPinDistrictMap from './delhiPinDistrictMap.json' with { type: 'json' };

/** India Post / cleaned master districts for Delhi PINs (boot-time heal fallback). */
export const DELHI_PIN_DISTRICT_BY_CODE = delhiPinDistrictMap;

const PIN_BATCH = 400;

function districtKey(stateId, name) {
  return `${stateId}|${normGeoKey(name)}`;
}

/**
 * Remap active PIN rows with missing/orphan districtId to a live district.
 * Idempotent — safe to run on every boot.
 */
export async function healOrphanPinDistrictLinks() {
  const [districts, states] = await Promise.all([
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
  const stateNameById = new Map(states.map((s) => [String(s._id), s.name]));

  let healed = 0;
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

      await upsertDocument('geo_pin_codes', {
        ...pin,
        stateId: district.stateId || pin.stateId,
        districtId: district._id,
        districtName: district.name,
        stateName: stateNameById.get(String(district.stateId)) || pin.stateName || '',
        updatedAt: new Date().toISOString(),
      });
      healed += 1;
    }

    skip += pins.length;
    if (pins.length < PIN_BATCH) break;
  }

  return { healed, skipped, checked };
}
