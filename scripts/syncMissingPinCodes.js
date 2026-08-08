#!/usr/bin/env node
/**
 * Sync PIN rows missing from live master using the cleaned PIN export.
 *
 * Usage:
 *   node scripts/syncMissingPinCodes.js [cleaned.json]
 *
 * Default input: server/data/exports/pin-code-master-cleaned-2026-07-30.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { GeoCity, GeoDistrict, GeoPinCode, GeoState } from '../src/modules/geo/geo.model.js';
import { bulkUpsertDocuments } from '../src/store/persistence.js';
import {
  buildGeoResolverIndexes,
  normalizePinGeoRow,
  normGeoKey,
} from '../src/modules/geo/pinCodeGeoNormalize.js';
import { resolveZoneNameForState } from '../src/modules/geo/geo.zones.js';
import { healOrphanPinDistrictLinks } from '../src/modules/geo/pinCodeHeal.js';
import { connectDb, disconnectDb } from '../src/config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultInput = path.join(__dirname, '..', 'data', 'exports', 'pin-code-master-cleaned-2026-07-30.json');
const inputPath = path.resolve(process.argv[2] || defaultInput);

async function main() {
  await connectDb();
  const heal = await healOrphanPinDistrictLinks();
  console.log('[pins] orphan district heal', heal);

  if (!fs.existsSync(inputPath)) {
    console.error(`Cleaned PIN file not found: ${inputPath}`);
    await disconnectDb();
    process.exit(heal.healed ? 0 : 1);
  }

  const cleaned = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const rows = Array.isArray(cleaned) ? cleaned : [];
  const [states, districts, cities, existing] = await Promise.all([
    GeoState.find({ isDeleted: false }),
    GeoDistrict.find({ isDeleted: false }),
    GeoCity.find({ isDeleted: false }),
    GeoPinCode.find({ isDeleted: false }),
  ]);

  const existingByPin = new Map(existing.map((p) => [String(p.pinCode), p]));
  const districtById = new Map(districts.map((d) => [String(d._id), d]));
  const indexes = buildGeoResolverIndexes({ states, districts, cities });
  const now = new Date().toISOString();
  const upserts = [];
  let added = 0;
  let updated = 0;
  let unresolved = 0;

  for (const row of rows) {
    const pinCode = String(row.pinCode || '').replace(/\D+/g, '');
    if (!/^\d{6}$/.test(pinCode)) continue;

    // Resolve state/district only — city stays optional (Camp One picks city separately).
    const normalized = normalizePinGeoRow(
      {
        pinCode,
        stateName: row.state || row.stateName || '',
        districtName: row.district || row.districtName || '',
        cityName: '',
        zoneName: row.zone || row.zoneName || '',
      },
      indexes
    );

    if (!normalized?.ok) {
      unresolved += 1;
      continue;
    }

    const state = indexes.stateByName.get(normGeoKey(normalized.state));
    const district =
      indexes.districtByKey.get(`${state._id}|${normGeoKey(normalized.seedDistrict || normalized.district)}`)
      || indexes.districts.find(
        (d) => d.stateId === state._id && normGeoKey(d.name) === normGeoKey(normalized.seedDistrict || normalized.district)
      );
    if (!state || !district) {
      unresolved += 1;
      continue;
    }

    const prev = existingByPin.get(pinCode);
    const districtBroken = Boolean(prev && !districtById.has(String(prev.districtId || '')));
    if (prev && !districtBroken) continue;

    const next = {
      ...(prev || {
        _id: randomUUID().replace(/-/g, '').slice(0, 24),
        createdAt: now,
        isDeleted: false,
        isActive: true,
        locality: '',
        notes: '',
        cityId: null,
        cityName: '',
      }),
      pinCode,
      stateId: state._id,
      districtId: district._id,
      stateName: state.name,
      districtName: district.name,
      zone: normalized.zone || resolveZoneNameForState(state.name) || '',
      updatedAt: now,
      isDeleted: false,
      isActive: true,
    };

    upserts.push(next);
    existingByPin.set(pinCode, next);
    if (prev) updated += 1;
    else added += 1;
  }

  if (upserts.length) {
    await bulkUpsertDocuments('geo_pin_codes', upserts);
  }

  console.log('[pins] sync missing/broken', { added, updated, unresolved, upserts: upserts.length });
  await disconnectDb();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
