import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GeoCity, GeoDistrict, GeoPinCode, GeoState } from './geo.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.resolve(__dirname, 'seed/india-geo.json');

/**
 * Load India geography masters once from the bundled seed
 * (dr5hn CSC states/cities + open India districts). PIN codes stay empty.
 */
export async function ensureGeoSeed() {
  const existingStates = await GeoState.countDocuments({ isDeleted: false });
  if (existingStates > 0) return { seeded: false, states: existingStates };

  if (!fs.existsSync(SEED_PATH)) {
    console.warn('[geo] Seed file missing:', SEED_PATH);
    return { seeded: false, error: 'SEED_MISSING' };
  }

  const payload = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const now = new Date().toISOString();

  const stamp = (rows) =>
    (rows || []).map((row) => ({
      ...row,
      createdAt: row.createdAt || now,
      updatedAt: row.updatedAt || now,
      isDeleted: false,
      isActive: row.isActive !== false,
    }));

  GeoState._write(stamp(payload.states));
  GeoDistrict._write(stamp(payload.districts));
  GeoCity._write(stamp(payload.cities));
  // PIN master intentionally empty for admin population over time
  if ((await GeoPinCode.countDocuments({})) === 0) {
    GeoPinCode._write([]);
  }

  const counts = payload.meta?.counts || {
    states: payload.states?.length || 0,
    districts: payload.districts?.length || 0,
    cities: payload.cities?.length || 0,
  };
  console.log(
    `[geo] Seeded India masters: ${counts.states} states, ${counts.districts} districts, ${counts.cities} cities (PIN codes empty)`
  );
  return { seeded: true, counts };
}
