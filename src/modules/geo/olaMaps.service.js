import { env } from '../../config/env.js';
import { AppError } from '../../utils/helpers.js';

const OLA_AUTOCOMPLETE_URL = 'https://api.olamaps.io/places/v1/autocomplete';
const OLA_GEOCODE_URL = 'https://api.olamaps.io/places/v1/geocode';
const OLA_DIRECTIONS_BASIC_URL = 'https://api.olamaps.io/routing/v1/directions/basic';
const MIN_QUERY_LEN = 3;
const REQUEST_TIMEOUT_MS = 8000;
const pinGeocodeCache = new Map();
const travelCache = new Map();

export function extractIndiaPin(text) {
  const match = String(text || '').match(/\b(\d{6})\b/);
  return match ? match[1] : '';
}

export function parseOlaGeocode(body = {}) {
  const first = body.geocodingResults?.[0] || body.results?.[0] || null;
  const lat = Number(first?.geometry?.location?.lat);
  const lng = Number(first?.geometry?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: String(lat), longitude: String(lng) };
}

export function normalizeOlaDistanceKm(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 250 ? n / 1000 : n;
}

export function parseOlaDirectionsKm(body = {}) {
  const route = body.routes?.[0] || body.route || null;
  const leg = route?.legs?.[0] || null;
  const candidates = [
    leg?.distance?.value,
    leg?.distance,
    route?.distance?.value,
    route?.distance,
    route?.readable_distance,
    body.distance,
    body.readable_distance,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const match = candidate.match(/([\d.]+)/);
      const km = normalizeOlaDistanceKm(match?.[1]);
      if (km) return km;
      continue;
    }
    const km = normalizeOlaDistanceKm(candidate);
    if (km) return km;
  }
  return null;
}

export function roundTripKmFromOneWay(oneWayKm) {
  if (!Number.isFinite(oneWayKm) || oneWayKm <= 0) return null;
  const roundTrip = Math.round(oneWayKm * 2 * 10) / 10;
  return roundTrip > 0 ? roundTrip : null;
}

export function parseMapCoordPair(lat, lng) {
  const latRaw = String(lat ?? '').trim();
  const lngRaw = String(lng ?? '').trim();
  if (!latRaw || !lngRaw) return null;
  const latitude = Number(latRaw);
  const longitude = Number(lngRaw);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

export function travelEstimateCacheKey({ pin, destLat, destLng }) {
  const pinKey = extractIndiaPin(pin);
  const coords = parseMapCoordPair(destLat, destLng);
  if (!pinKey || !coords) return '';
  return `${pinKey}|${coords.latitude.toFixed(4)}|${coords.longitude.toFixed(4)}`;
}

export function isOlaMapsConfigured() {
  return Boolean(env.olaMapsApiKey);
}

export function mapOlaPredictions(body = {}) {
  const rows = Array.isArray(body.predictions) ? body.predictions : [];
  return rows.map((pred, index) => {
    const lat = Number(pred?.geometry?.location?.lat);
    const lng = Number(pred?.geometry?.location?.lng);
    const label = String(
      pred?.structured_formatting?.main_text || pred?.description || ''
    ).trim();
    const secondaryText = String(pred?.structured_formatting?.secondary_text || '').trim();
    const campAddress = String(pred?.description || label).trim();
    const placeId = String(pred?.place_id || pred?.reference || '').trim()
      || `ola-${index}-${campAddress}`;
    if (!campAddress && !label) return null;
    return {
      placeId,
      label: label || campAddress,
      secondaryText,
      campAddress: campAddress || label,
      pinCode: extractIndiaPin(`${campAddress} ${secondaryText}`),
      latitude: Number.isFinite(lat) ? String(lat) : '',
      longitude: Number.isFinite(lng) ? String(lng) : '',
    };
  }).filter(Boolean);
}

function assertOlaConfigured() {
  if (!isOlaMapsConfigured()) {
    throw new AppError(
      'Address suggestions are not configured on the server',
      503,
      'OLA_MAPS_NOT_CONFIGURED',
    );
  }
}

export async function autocompleteOlaMaps(input) {
  assertOlaConfigured();
  const q = String(input || '').trim();
  if (q.length < MIN_QUERY_LEN) return [];

  const url = new URL(OLA_AUTOCOMPLETE_URL);
  url.searchParams.set('input', q);
  url.searchParams.set('api_key', env.olaMapsApiKey);

  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError(
      'Address suggestions are unavailable right now',
      502,
      'OLA_MAPS_UNAVAILABLE',
    );
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body.status && String(body.status).toLowerCase() !== 'ok')) {
    console.error('[ola-maps] autocomplete failed', res.status, body?.error_message || body?.status);
    throw new AppError(
      'Address suggestions are unavailable right now',
      res.status >= 500 ? 502 : 400,
      'OLA_MAPS_AUTOCOMPLETE_FAILED',
    );
  }

  return mapOlaPredictions(body);
}

async function olaGet(url) {
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError(
      'Address lookup is unavailable right now',
      502,
      'OLA_MAPS_UNAVAILABLE',
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AppError(
      'Address lookup is unavailable right now',
      res.status >= 500 ? 502 : 400,
      'OLA_MAPS_REQUEST_FAILED',
    );
  }
  return body;
}

export async function geocodeOlaPin(pin) {
  assertOlaConfigured();
  const pinCode = extractIndiaPin(pin);
  if (!pinCode) {
    throw new AppError('PIN code must be 6 digits', 400, 'TRAVEL_PIN_MISSING');
  }
  if (pinGeocodeCache.has(pinCode)) return pinGeocodeCache.get(pinCode);

  const url = new URL(OLA_GEOCODE_URL);
  url.searchParams.set('address', `${pinCode}, India`);
  url.searchParams.set('api_key', env.olaMapsApiKey);
  const coords = parseOlaGeocode(await olaGet(url));
  if (!coords) {
    throw new AppError(
      'Could not resolve the PIN code to a location',
      502,
      'OLA_MAPS_GEOCODE_FAILED',
    );
  }
  pinGeocodeCache.set(pinCode, coords);
  return coords;
}

export async function directionsOlaOneWayKm(origin, destination) {
  assertOlaConfigured();
  const from = parseMapCoordPair(origin?.latitude, origin?.longitude);
  const to = parseMapCoordPair(destination?.latitude, destination?.longitude);
  if (!from || !to) {
    throw new AppError('Camp coordinates are missing', 400, 'TRAVEL_CAMP_COORDS_MISSING');
  }
  const originLat = from.latitude;
  const originLng = from.longitude;
  const destLat = to.latitude;
  const destLng = to.longitude;

  const url = new URL(OLA_DIRECTIONS_BASIC_URL);
  url.searchParams.set('origin', `${originLat},${originLng}`);
  url.searchParams.set('destination', `${destLat},${destLng}`);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('steps', 'false');
  url.searchParams.set('overview', 'false');
  url.searchParams.set('api_key', env.olaMapsApiKey);
  const km = parseOlaDirectionsKm(await olaGet(url));
  if (!km) {
    throw new AppError(
      'Could not estimate travel distance',
      502,
      'OLA_MAPS_DIRECTIONS_FAILED',
    );
  }
  return km;
}

export async function estimateOlaRoundTripKm({ pin, destLat, destLng, originLat, originLng } = {}) {
  const key = travelEstimateCacheKey({ pin, destLat, destLng });
  if (!extractIndiaPin(pin)) {
    throw new AppError('HCW PIN code is missing', 400, 'TRAVEL_PIN_MISSING');
  }
  if (!parseMapCoordPair(destLat, destLng)) {
    throw new AppError('Camp coordinates are missing', 400, 'TRAVEL_CAMP_COORDS_MISSING');
  }
  if (key && travelCache.has(key)) return travelCache.get(key);

  let origin;
  try {
    origin = await geocodeOlaPin(pin);
  } catch (err) {
    const fallback = parseMapCoordPair(originLat, originLng);
    if (fallback) {
      origin = { latitude: String(fallback.latitude), longitude: String(fallback.longitude) };
    } else {
      throw err;
    }
  }
  const oneWayKm = await directionsOlaOneWayKm(origin, {
    latitude: destLat,
    longitude: destLng,
  });
  const kmRoundTrip = roundTripKmFromOneWay(oneWayKm);
  if (!kmRoundTrip) {
    throw new AppError(
      'Could not estimate travel distance',
      502,
      'OLA_MAPS_DIRECTIONS_FAILED',
    );
  }
  const result = {
    pin: extractIndiaPin(pin),
    origin,
    destination: { latitude: String(destLat), longitude: String(destLng) },
    kmOneWay: Math.round(oneWayKm * 10) / 10,
    kmRoundTrip,
    cached: false,
  };
  travelCache.set(key, { ...result, cached: true });
  return result;
}
