import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GeoCity, GeoDistrict, GeoPinCode, GeoState, GeoZone } from './geo.model.js';
import { ensureGeoZoneSeed } from './geo.zones.seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.resolve(__dirname, 'seed/india-geo.json');

function readGeoSeedPayload() {
  if (!fs.existsSync(SEED_PATH)) {
    return { error: 'SEED_MISSING', path: SEED_PATH };
  }
  return { payload: JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) };
}

function stampGeoRows(rows, now = new Date().toISOString()) {
  return (rows || []).map((row) => ({
    ...row,
    createdAt: row.createdAt || now,
    updatedAt: row.updatedAt || now,
    isDeleted: false,
    isActive: row.isActive !== false,
  }));
}

async function writeGeoSeedPayload(payload) {
  const now = new Date().toISOString();
  GeoState._write(stampGeoRows(payload.states, now));
  GeoDistrict._write(stampGeoRows(payload.districts, now));
  GeoCity._write(stampGeoRows(payload.cities, now));
  if ((await GeoPinCode.countDocuments({})) === 0) {
    GeoPinCode._write([]);
  }
  return payload.meta?.counts || {
    states: payload.states?.length || 0,
    districts: payload.districts?.length || 0,
    cities: payload.cities?.length || 0,
  };
}

async function geoMasterLooksComplete() {
  const { payload, error } = readGeoSeedPayload();
  if (error) return true;

  const expected = payload.meta?.counts || {};
  const [states, districts, cities, zones] = await Promise.all([
    GeoState.countDocuments({ isDeleted: false }),
    GeoDistrict.countDocuments({ isDeleted: false }),
    GeoCity.countDocuments({ isDeleted: false }),
    GeoZone.countDocuments({ isDeleted: false }),
  ]);

  return (
    states >= (expected.states || 36) &&
    districts >= Math.floor((expected.districts || 693) * 0.95) &&
    cities >= Math.floor((expected.cities || 4198) * 0.95) &&
    zones >= 6
  );
}

/**
 * Load India geography masters once from the bundled seed
 * (dr5hn CSC states/cities + open India districts). PIN codes stay empty.
 */
export async function ensureGeoSeed() {
  if (await geoMasterLooksComplete()) {
    const states = await GeoState.countDocuments({ isDeleted: false });
    return { seeded: false, states };
  }

  const { payload, error, path: seedPath } = readGeoSeedPayload();
  if (error) {
    console.warn('[geo] Seed file missing:', seedPath);
    return { seeded: false, error };
  }

  const existingStates = await GeoState.countDocuments({ isDeleted: false });
  if (existingStates > 0) {
    console.log('[geo] Incomplete geo master detected — reloading from bundled seed');
    return forceReseedGeoMasters();
  }

  const counts = await writeGeoSeedPayload(payload);
  console.log(
    `[geo] Seeded India masters: ${counts.states} states, ${counts.districts} districts, ${counts.cities} cities (PIN codes empty)`
  );
  await ensureGeoZoneSeed();
  return { seeded: true, counts };
}

/**
 * Overwrite states, districts, cities, and zones from the bundled seed.
 * Preserves admin-entered PIN code mappings.
 */
export async function forceReseedGeoMasters() {
  const { payload, error, path: seedPath } = readGeoSeedPayload();
  if (error) {
    throw new Error(`Geo seed file missing: ${seedPath}`);
  }

  const pinCodes = await GeoPinCode.find({ isDeleted: false });
  const counts = await writeGeoSeedPayload(payload);
  const zoneResult = await ensureGeoZoneSeed({ force: true });
  console.log(
    `[geo] Force-reseeded India masters: ${counts.states} states, ${counts.districts} districts, ${counts.cities} cities; ${zoneResult.zones} zones; ${pinCodes.length} PIN codes preserved`
  );
  return {
    reseeded: true,
    counts,
    zones: zoneResult.zones,
    pinCodesPreserved: pinCodes.length,
    sourcedAt: payload.meta?.sourcedAt || null,
  };
}

/** Ensure zone master exists even when geo states were seeded earlier. */
export async function ensureGeoMasters() {
  await ensureGeoSeed();
  await ensureGeoZoneSeed();
}
