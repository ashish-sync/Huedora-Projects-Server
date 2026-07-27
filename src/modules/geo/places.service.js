import { env } from '../../config/env.js';
import { AppError } from '../../utils/helpers.js';

const PLACES_BASE = 'https://places.googleapis.com/v1';

function assertPlacesConfigured() {
  if (!env.googleMapsApiKey) {
    throw new AppError('Google Places is not configured on the server', 503, 'PLACES_NOT_CONFIGURED');
  }
}

function placesHeaders(fieldMask) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': env.googleMapsApiKey,
  };
  if (fieldMask) headers['X-Goog-FieldMask'] = fieldMask;
  return headers;
}

function normalizePlaceId(placeId, placeResource) {
  const raw = String(placeId || placeResource || '').trim();
  if (!raw) return '';
  return raw.startsWith('places/') ? raw.slice('places/'.length) : raw;
}

function componentValue(components, type, field = 'longText') {
  if (!Array.isArray(components)) return '';
  const hit = components.find((c) => Array.isArray(c.types) && c.types.includes(type));
  if (!hit) return '';
  return hit[field] || hit.longText || hit.shortText || hit.long_name || hit.short_name || '';
}

function mapPlaceToCampFields(place) {
  const components = place.addressComponents || [];
  const city =
    componentValue(components, 'locality')
    || componentValue(components, 'postal_town')
    || componentValue(components, 'sublocality_level_1')
    || componentValue(components, 'administrative_area_level_2')
    || '';
  const district =
    componentValue(components, 'administrative_area_level_3')
    || componentValue(components, 'administrative_area_level_2')
    || '';
  const state = componentValue(components, 'administrative_area_level_1');
  const pincode = componentValue(components, 'postal_code', 'shortText');

  const lat = place.location?.latitude;
  const lng = place.location?.longitude;

  const campAddress =
    place.formattedAddress
    || place.displayName?.text
    || '';

  return {
    campAddress,
    city,
    district,
    state,
    pincode,
    latitude: Number.isFinite(lat) ? String(lat) : '',
    longitude: Number.isFinite(lng) ? String(lng) : '',
  };
}

export async function autocompletePlaces(input) {
  assertPlacesConfigured();
  const q = String(input || '').trim();
  if (q.length < 3) return [];

  const res = await fetch(`${PLACES_BASE}/places:autocomplete`, {
    method: 'POST',
    headers: placesHeaders(),
    body: JSON.stringify({
      input: q,
      includedRegionCodes: ['in'],
      languageCode: 'en',
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[places] autocomplete failed', res.status, body?.error?.message || body);
    throw new AppError(
      body?.error?.message || 'Place autocomplete failed',
      res.status >= 500 ? 502 : 400,
      'PLACES_AUTOCOMPLETE_FAILED'
    );
  }

  return (body.suggestions || [])
    .map((suggestion) => {
      const pred = suggestion.placePrediction;
      if (!pred) return null;
      const placeId = normalizePlaceId(pred.placeId, pred.place);
      if (!placeId) return null;
      return {
        placeId,
        label: pred.text?.text || pred.structuredFormat?.mainText?.text || '',
        secondaryText: pred.structuredFormat?.secondaryText?.text || '',
      };
    })
    .filter(Boolean);
}

export async function getPlaceDetails(placeId) {
  assertPlacesConfigured();
  const id = normalizePlaceId(placeId);
  if (!id) throw new AppError('placeId is required', 400, 'VALIDATION_ERROR');

  const res = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(id)}`, {
    headers: placesHeaders('formattedAddress,addressComponents,location,displayName'),
  });

  const place = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[places] details failed', res.status, place?.error?.message || place);
    throw new AppError(
      place?.error?.message || 'Place details failed',
      res.status >= 500 ? 502 : 400,
      'PLACES_DETAILS_FAILED'
    );
  }

  return mapPlaceToCampFields(place);
}
