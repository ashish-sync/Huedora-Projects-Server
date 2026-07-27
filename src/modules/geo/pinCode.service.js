import { AppError } from '../../utils/helpers.js';
import { GeoCity, GeoDistrict, GeoPinCode, GeoState } from './geo.model.js';

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
  const city = cityId ? await GeoCity.findOne({ _id: cityId, isDeleted: false }) : null;
  if (cityId && !city) throw new AppError('City not found', 404);

  let district = null;
  const dId = districtId || city?.districtId;
  if (dId) {
    district = await GeoDistrict.findOne({ _id: dId, isDeleted: false });
  }

  let state = null;
  const sId = stateId || city?.stateId || district?.stateId;
  if (sId) {
    state = await GeoState.findOne({ _id: sId, isDeleted: false });
  }
  if (!state) throw new AppError('State is required for a PIN mapping', 400, 'VALIDATION_ERROR');
  if (!city) throw new AppError('City is required for a PIN mapping', 400, 'VALIDATION_ERROR');

  return { city, district, state };
}

export async function resolveGeoNames({ stateName, districtName, cityName }) {
  const state = await GeoState.findOne({
    isDeleted: false,
    name: new RegExp(`^${String(stateName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
  });
  if (!state) throw new AppError(`State not found: ${stateName}`, 400, 'VALIDATION_ERROR');

  if (!districtName) {
    throw new AppError('District is required', 400, 'VALIDATION_ERROR');
  }
  const district = await GeoDistrict.findOne({
    isDeleted: false,
    stateId: state._id,
    name: new RegExp(`^${String(districtName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
  });
  if (!district) {
    throw new AppError(`District not found: ${districtName}`, 400, 'VALIDATION_ERROR');
  }

  const city = await GeoCity.findOne({
    isDeleted: false,
    stateId: state._id,
    name: new RegExp(`^${String(cityName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
  });
  if (!city) throw new AppError(`City not found: ${cityName}`, 400, 'VALIDATION_ERROR');

  return resolvePinTargets({
    cityId: city._id,
    districtId: district._id,
    stateId: state._id,
  });
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
  return list.map((row) => ({
    ...row,
    stateName: maps.states[String(row.stateId)]?.name || row.stateName || '',
    districtName: maps.districts[String(row.districtId)]?.name || row.districtName || '',
    cityName: maps.cities[String(row.cityId)]?.name || row.cityName || '',
  }));
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
  return [
    row.pinCode,
    row.stateName || '',
    row.districtName || '',
    row.cityName || '',
    row.locality || '',
    row.notes || '',
    row.isActive === false ? 'No' : 'Yes',
  ];
}
