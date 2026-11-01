import { env } from '../../config/env.js';
import { AppError } from '../../utils/helpers.js';

const OLA_AUTOCOMPLETE_URL = 'https://api.olamaps.io/places/v1/autocomplete';
const MIN_QUERY_LEN = 3;
const REQUEST_TIMEOUT_MS = 8000;

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
