import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateOlaRoundTripKm,
  extractIndiaPin,
  mapOlaPredictions,
  normalizeOlaDistanceKm,
  parseOlaDirectionsKm,
  parseMapCoordPair,
  parseOlaGeocode,
  roundTripKmFromOneWay,
  travelEstimateCacheKey,
} from './olaMaps.service.js';

test('mapOlaPredictions keeps address and coordinates from autocomplete', () => {
  const rows = mapOlaPredictions({
    status: 'ok',
    predictions: [
      {
        description: 'Kempegowda International Airport Bengaluru (BLR), KIAL Rd, Devanahalli, Bengaluru, Karnataka, India',
        place_id: 'ola-platform:a1e99e3bd07b545284643f7bde183120',
        structured_formatting: {
          main_text: 'Kempegowda International Airport Bengaluru (BLR)',
          secondary_text: 'KIAL Rd, Devanahalli, Bengaluru, Karnataka, India',
        },
        geometry: { location: { lat: 13.05158, lng: 77.61194 } },
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].placeId, 'ola-platform:a1e99e3bd07b545284643f7bde183120');
  assert.equal(rows[0].label, 'Kempegowda International Airport Bengaluru (BLR)');
  assert.equal(rows[0].secondaryText, 'KIAL Rd, Devanahalli, Bengaluru, Karnataka, India');
  assert.match(rows[0].campAddress, /Bengaluru/);
  assert.equal(rows[0].latitude, '13.05158');
  assert.equal(rows[0].longitude, '77.61194');
});

test('mapOlaPredictions keeps a suggestion when geometry is missing', () => {
  const rows = mapOlaPredictions({
    predictions: [{ description: 'Andheri West, Mumbai, Maharashtra, India' }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].campAddress, 'Andheri West, Mumbai, Maharashtra, India');
  assert.equal(rows[0].latitude, '');
  assert.equal(rows[0].longitude, '');
  assert.ok(rows[0].placeId);
});

test('mapOlaPredictions ignores empty predictions', () => {
  assert.deepEqual(mapOlaPredictions({ predictions: [{}, null] }), []);
  assert.deepEqual(mapOlaPredictions({}), []);
});

test('mapOlaPredictions extracts a 6-digit PIN from the suggestion text', () => {
  const rows = mapOlaPredictions({
    predictions: [{
      description: 'Home, Andheri West, Mumbai, Maharashtra 400058, India',
      structured_formatting: {
        main_text: 'Home',
        secondary_text: 'Andheri West, Mumbai, Maharashtra 400058, India',
      },
      geometry: { location: { lat: 19.1197, lng: 72.8468 } },
    }],
  });
  assert.equal(rows[0].pinCode, '400058');
});

test('extractIndiaPin and geocode parser', () => {
  assert.equal(extractIndiaPin('PIN 400058 MH'), '400058');
  assert.equal(extractIndiaPin('12'), '');
  assert.deepEqual(parseOlaGeocode({
    geocodingResults: [{ geometry: { location: { lat: 19.1, lng: 72.8 } } }],
  }), { latitude: '19.1', longitude: '72.8' });
  assert.equal(parseOlaGeocode({}), null);
  assert.equal(parseMapCoordPair('', '72.8'), null);
  assert.equal(parseMapCoordPair(0, 0), null);
  assert.deepEqual(parseMapCoordPair('19.1', '72.8'), { latitude: 19.1, longitude: 72.8 });
});

test('directions parser never treats a zero distance as a usable estimate', () => {
  assert.equal(parseOlaDirectionsKm({ routes: [{ distance: 0 }] }), null);
  assert.equal(parseOlaDirectionsKm({ routes: [{ legs: [{ distance: { value: 12400 } }] }] }), 12.4);
  assert.equal(parseOlaDirectionsKm({ routes: [{ readable_distance: '8.5 km' }] }), 8.5);
  assert.equal(normalizeOlaDistanceKm(0), null);
  assert.equal(roundTripKmFromOneWay(0), null);
  assert.equal(roundTripKmFromOneWay(-2), null);
  assert.equal(roundTripKmFromOneWay(12.34), 24.7);
});

test('travel estimate cache key is pin + rounded camp coordinates', () => {
  assert.equal(
    travelEstimateCacheKey({ pin: '400058', destLat: 19.11971, destLng: 72.84683 }),
    '400058|19.1197|72.8468',
  );
  assert.equal(travelEstimateCacheKey({ pin: '', destLat: 19.1, destLng: 72.8 }), '');
  assert.equal(
    travelEstimateCacheKey({ pin: '400058', destLat: '', destLng: '', destPin: '560001' }),
    '400058|pin:560001',
  );
});

test('estimateOlaRoundTripKm fails closed without writing a zero distance', async () => {
  await assert.rejects(
    () => estimateOlaRoundTripKm({ pin: '', destLat: 19.1, destLng: 72.8 }),
    (err) => err.code === 'TRAVEL_PIN_MISSING',
  );
  await assert.rejects(
    () => estimateOlaRoundTripKm({ pin: '400058', destLat: '', destLng: '' }),
    (err) => err.code === 'TRAVEL_CAMP_COORDS_MISSING',
  );
});
