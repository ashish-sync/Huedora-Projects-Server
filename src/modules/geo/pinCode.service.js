import { randomUUID } from 'crypto';
import { AppError } from '../../utils/helpers.js';
import { resolveZoneNameForState } from './geo.zones.js';
import { GeoCity, GeoDistrict, GeoPinCode, GeoState } from './geo.model.js';

function normGeoName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildGeoIndexes(states, districts, cities) {
  const stateByName = new Map();
  for (const state of states) {
    if (state.isDeleted) continue;
    stateByName.set(normGeoName(state.name), state);
  }

  const districtByKey = new Map();
  for (const district of districts) {
    if (district.isDeleted) continue;
    districtByKey.set(`${district.stateId}|${normGeoName(district.name)}`, district);
  }

  const citiesByDistrict = new Map();
  const citiesByState = new Map();
  const cityByStateAndName = new Map();
  for (const city of cities) {
    if (city.isDeleted) continue;
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
    cityByStateAndName.set(`${stateKey}|${normGeoName(city.name)}`, city);
  }

  return { stateByName, districtByKey, citiesByDistrict, citiesByState, cityByStateAndName };
}

function resolveCityForDistrict({ district, state }, indexes) {
  const districtId = String(district._id);
  const districtNorm = normGeoName(district.name);
  const inDistrict = indexes.citiesByDistrict.get(districtId) || [];

  const districtCity = inDistrict.find((city) => normGeoName(city.name) === districtNorm);
  if (districtCity) return districtCity;
  if (inDistrict.length) return inDistrict[0];

  const stateKey = String(state._id);
  const stateCity = indexes.cityByStateAndName.get(`${stateKey}|${districtNorm}`);
  if (stateCity) return stateCity;

  const inState = indexes.citiesByState.get(stateKey) || [];
  if (inState.length) return inState[0];
  return null;
}

function resolveGeoFromNames({ stateName, districtName, cityName = '' }, indexes) {
  const state = indexes.stateByName.get(normGeoName(stateName));
  if (!state) throw new AppError(`State not found: ${stateName}`, 400, 'VALIDATION_ERROR');

  const district = indexes.districtByKey.get(`${state._id}|${normGeoName(districtName)}`);
  if (!district) throw new AppError(`District not found: ${districtName}`, 400, 'VALIDATION_ERROR');

  let city = null;
  if (cityName) {
    city = indexes.cityByStateAndName.get(`${state._id}|${normGeoName(cityName)}`);
    if (!city) throw new AppError(`City not found: ${cityName}`, 400, 'VALIDATION_ERROR');
  } else {
    city = resolveCityForDistrict({ district, state }, indexes);
    if (!city) {
      throw new AppError(`No city found for district: ${districtName}`, 400, 'VALIDATION_ERROR');
    }
  }

  return { state, district, city };
}

function rowData(row) {
  return row?.toObject ? row.toObject() : { ...(row || {}) };
}

export function pinFilterFromGeo({ stateId, districtId, cityId, active = true } = {}) {
  const filter = { isDeleted: false };
  if (active !== false) filter.isActive = true;
  if (cityId) filter.cityId = String(cityId);
  else if (districtId) filter.districtId = String(districtId);
  else if (stateId) filter.stateId = String(stateId);
  return filter;
}

/** Build normalized PIN record payload (IDs only — names resolved at read time). */
export function normalizedPinPayload({ pinCode, city, district, state, locality = '', notes = '', isActive = true }) {
  return {
    pinCode: String(pinCode || '').replace(/\D+/g, ''),
    cityId: city._id,
    districtId: district?._id || city.districtId || null,
    stateId: state._id,
    locality: String(locality || '').trim(),
    notes: String(notes || '').trim(),
    isActive: isActive !== false,
  };
}

export async function resolvePinTargets({ cityId, districtId, stateId }) {
  let city = cityId ? await GeoCity.findOne({ _id: cityId, isDeleted: false }) : null;
  if (cityId && !city) throw new AppError('City not found', 404);

  let district = null;
  const dId = districtId || city?.districtId;
  if (dId) {
    district = await GeoDistrict.findOne({ _id: dId, isDeleted: false });
  }
  if (districtId && !district) throw new AppError('District not found', 404);

  let state = null;
  const sId = stateId || city?.stateId || district?.stateId;
  if (sId) {
    state = await GeoState.findOne({ _id: sId, isDeleted: false });
  }
  if (!state) throw new AppError('State is required for a PIN mapping', 400, 'VALIDATION_ERROR');
  if (!district) throw new AppError('District is required for a PIN mapping', 400, 'VALIDATION_ERROR');

  if (!city) {
    const [states, districts, cities] = await Promise.all([
      GeoState.find({ isDeleted: false }),
      GeoDistrict.find({ isDeleted: false }),
      GeoCity.find({ isDeleted: false }),
    ]);
    const indexes = buildGeoIndexes(states, districts, cities);
    city = resolveCityForDistrict({ district, state }, indexes);
    if (!city) {
      throw new AppError(`No city found for district: ${district.name}`, 400, 'VALIDATION_ERROR');
    }
  }

  return { city, district, state };
}

export async function resolveGeoNames({ stateName, districtName, cityName = '' }) {
  const [states, districts, cities] = await Promise.all([
    GeoState.find({ isDeleted: false }),
    GeoDistrict.find({ isDeleted: false }),
    GeoCity.find({ isDeleted: false }),
  ]);
  const indexes = buildGeoIndexes(states, districts, cities);
  return resolveGeoFromNames({ stateName, districtName, cityName }, indexes);
}

async function loadGeoMaps(rows) {
  const stateIds = [...new Set(rows.map((r) => String(r.stateId || '')).filter(Boolean))];
  const districtIds = [...new Set(rows.map((r) => String(r.districtId || '')).filter(Boolean))];
  const cityIds = [...new Set(rows.map((r) => String(r.cityId || '')).filter(Boolean))];

  const [states, districts, cities] = await Promise.all([
    stateIds.length ? GeoState.find({ _id: { $in: stateIds }, isDeleted: false }) : [],
    districtIds.length ? GeoDistrict.find({ _id: { $in: districtIds }, isDeleted: false }) : [],
    cityIds.length ? GeoCity.find({ _id: { $in: cityIds }, isDeleted: false }) : [],
  ]);

  return {
    states: Object.fromEntries(states.map((s) => [String(s._id), s])),
    districts: Object.fromEntries(districts.map((d) => [String(d._id), d])),
    cities: Object.fromEntries(cities.map((c) => [String(c._id), c])),
  };
}

/** Attach state/district/city names from master references (no duplicated storage required). */
export async function enrichPinRecords(rows = []) {
  if (!rows.length) return [];
  const list = rows.map(rowData);
  const maps = await loadGeoMaps(list);
  return list.map((row) => {
    const stateName = maps.states[String(row.stateId)]?.name || row.stateName || '';
    return {
      ...row,
      stateName,
      districtName: maps.districts[String(row.districtId)]?.name || row.districtName || '',
      cityName: maps.cities[String(row.cityId)]?.name || row.cityName || '',
      zone: resolveZoneNameForState(stateName) || row.zone || '',
    };
  });
}

export async function enrichPinRecord(row) {
  const [enriched] = await enrichPinRecords([row]);
  return enriched;
}

export async function getPinPreview({ stateId, districtId, cityId, limit = 3, active = true } = {}) {
  if (!stateId && !districtId && !cityId) {
    return { count: 0, preview: [], more: 0, label: '' };
  }
  const filter = pinFilterFromGeo({ stateId, districtId, cityId, active });
  const count = await GeoPinCode.countDocuments(filter);
  const sample = await GeoPinCode.find(filter).sort('pinCode').limit(limit);
  const preview = sample.map((r) => r.pinCode);
  const more = Math.max(0, count - preview.length);
  return { count, preview, more, label: formatPinPreview({ count, preview, more }) };
}

export function formatPinPreview({ count, preview, more }) {
  if (!count) return 'No PIN codes mapped';
  const head = preview.join(', ');
  if (more > 0) return `${head}… +${more} more`;
  return head;
}

export async function countPinsGrouped(groupField) {
  const allPins = await GeoPinCode.find({ isDeleted: false, isActive: true });
  const counts = new Map();
  for (const pin of allPins) {
    const key = String(pin[groupField] || '');
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

export async function attachPinCounts(items = [], groupField) {
  if (!items.length || !groupField) return items;
  const counts = await countPinsGrouped(groupField);
  return items.map((item) => {
    const o = rowData(item);
    return { ...o, pinCount: counts.get(String(o._id)) || 0 };
  });
}

export async function upsertNormalizedPin({
  pinCode,
  city,
  district,
  state,
  locality = '',
  notes = '',
  isActive = true,
  updatedBy = null,
  existingId = null,
}) {
  const normalized = normalizedPinPayload({ pinCode, city, district, state, locality, notes, isActive });
  if (!/^\d{6}$/.test(normalized.pinCode)) {
    throw new AppError('PIN code must be 6 digits', 400, 'VALIDATION_ERROR');
  }

  const dupFilter = { pinCode: normalized.pinCode, isDeleted: false };
  const existing = await GeoPinCode.findOne(dupFilter);

  if (existing && existingId && String(existing._id) !== String(existingId)) {
    throw new AppError('PIN code already exists', 409, 'DUPLICATE_PIN');
  }

  if (existingId) {
    const row = await GeoPinCode.findOne({ _id: existingId, isDeleted: false });
    if (!row) throw new AppError('PIN code mapping not found', 404);
    Object.assign(row, normalized, { updatedBy });
    await row.save();
    return { row, created: false, updated: true };
  }

  if (existing) {
    Object.assign(existing, normalized, { updatedBy });
    await existing.save();
    return { row: existing, created: false, updated: true };
  }

  const row = await GeoPinCode.create({
    ...normalized,
    createdBy: updatedBy,
    updatedBy,
  });
  return { row, created: true, updated: false };
}

export function pinToExcelRow(row) {
  return [row.pinCode, row.stateName || '', row.zone || '', row.districtName || ''];
}

/**
 * Bulk-import PIN rows (State + District + PIN Code; City optional).
 * Loads geo masters once, resolves in memory, and persists with a single write.
 */
export async function bulkImportPinRows(inputRows = [], { updatedBy = null } = {}) {
  const [states, districts, cities, allPinRecords] = await Promise.all([
    GeoState.find({ isDeleted: false }),
    GeoDistrict.find({ isDeleted: false }),
    GeoCity.find({ isDeleted: false }),
    GeoPinCode._all(),
  ]);

  const indexes = buildGeoIndexes(states, districts, cities);
  const activeByPin = new Map();
  for (const record of allPinRecords) {
    if (!record.isDeleted && record.pinCode) {
      activeByPin.set(record.pinCode, { ...record });
    }
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];
  const now = new Date().toISOString();

  for (const input of inputRows) {
    const {
      rowNum,
      pinCode,
      stateName,
      districtName,
      cityName = '',
      locality = '',
      notes = '',
      isActive = true,
    } = input;

    try {
      if (!pinCode) {
        skipped += 1;
        continue;
      }
      if (!/^\d{6}$/.test(pinCode)) {
        throw new AppError('PIN code must be 6 digits', 400, 'VALIDATION_ERROR');
      }
      if (!stateName || !districtName) {
        throw new AppError('State and District are required', 400, 'VALIDATION_ERROR');
      }

      const { state, district, city } = resolveGeoFromNames(
        { stateName, districtName, cityName },
        indexes
      );
      const normalized = normalizedPinPayload({
        pinCode,
        city,
        district,
        state,
        locality: locality === '-' ? '' : locality,
        notes,
        isActive,
      });

      const existing = activeByPin.get(normalized.pinCode);
      if (existing) {
        Object.assign(existing, normalized, { updatedBy, updatedAt: now });
        updated += 1;
      } else {
        activeByPin.set(normalized.pinCode, {
          pinCode: '',
          cityId: null,
          districtId: null,
          stateId: null,
          locality: '',
          notes: '',
          isActive: true,
          isDeleted: false,
          ...normalized,
          _id: randomUUID(),
          createdBy: updatedBy,
          updatedBy,
          createdAt: now,
          updatedAt: now,
        });
        created += 1;
      }
    } catch (err) {
      errors.push({ row: rowNum, field: 'import', message: err.message });
    }
  }

  const deletedPins = allPinRecords.filter((record) => record.isDeleted);
  GeoPinCode._write([...deletedPins, ...activeByPin.values()]);

  return {
    created,
    updated,
    skipped,
    errors,
    totalRows: inputRows.length,
  };
}
