import { GeoPinCode } from '../../geo/geo.model.js';
import { enrichPinRecord } from '../../geo/pinCode.service.js';
import { resolveZoneNameForState } from '../../geo/geo.zones.js';
import { CAMP_OPS_SOURCES } from '../campOps.constants.js';
import { CAMP_SOURCE_LABELS } from '../campExportFieldSchema.js';

function trimStr(value) {
  return value == null ? '' : String(value).trim().replace(/\s+/g, ' ');
}

const SOURCE_ALIASES = {
  dashboard: 'dashboard',
  email: 'email',
  whatsapp: 'whatsapp',
  excel: 'excel',
  'excel import': 'excel',
  import: 'excel',
  paste: 'paste',
  'manual paste': 'paste',
  api: 'api',
  parser: 'parser',
  'request parser': 'parser',
};

/**
 * Map spreadsheet / form labels to CAMP_OPS_SOURCES values.
 * Falls back to `fallback` (typically `excel` for file upload).
 */
export function normalizeImportSource(value, fallback = 'excel') {
  const raw = trimStr(value);
  if (!raw) return fallback;

  const compact = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (CAMP_OPS_SOURCES.includes(compact)) return compact;
  if (SOURCE_ALIASES[compact]) return SOURCE_ALIASES[compact];

  for (const [key, label] of Object.entries(CAMP_SOURCE_LABELS)) {
    if (String(label).toLowerCase() === compact) return key;
  }

  return fallback;
}

/**
 * Fill state / district / zone / HQ (and city when blank) from PIN Geography master.
 * Keeps Create Camp upload template lean while request-stage validation stays complete.
 */
export async function enrichMappedImportRowsFromPin(rows = []) {
  const out = [];
  for (const row of rows) {
    const pin = String(row.pincode || '').replace(/\D/g, '').slice(0, 6);
    if (pin.length !== 6) {
      const state = trimStr(row.state);
      out.push({
        ...row,
        pincode: trimStr(row.pincode),
        district: trimStr(row.district) || trimStr(row.city),
        hq: trimStr(row.hq) || trimStr(row.city) || trimStr(row.district),
        zone: trimStr(row.zone) || (state ? resolveZoneNameForState(state) || '' : ''),
      });
      continue;
    }

    const matches = await GeoPinCode.find({
      pinCode: pin,
      isDeleted: false,
      isActive: true,
    });

    if (!matches.length) {
      const state = trimStr(row.state);
      out.push({
        ...row,
        pincode: pin,
        district: trimStr(row.district) || trimStr(row.city),
        hq: trimStr(row.hq) || trimStr(row.city) || trimStr(row.district),
        zone: trimStr(row.zone) || (state ? resolveZoneNameForState(state) || '' : ''),
      });
      continue;
    }

    const enriched = await enrichPinRecord(matches[0]);
    const state = trimStr(enriched.stateName) || trimStr(row.state);
    const district = trimStr(enriched.districtName) || trimStr(row.district);
    const cityFromPin = trimStr(enriched.cityName);
    const city = trimStr(row.city) || district || cityFromPin;
    const zone = resolveZoneNameForState(state) || trimStr(row.zone);

    out.push({
      ...row,
      pincode: pin,
      city,
      state,
      district: district || city,
      hq: trimStr(row.hq) || district || city,
      zone,
    });
  }
  return out;
}
