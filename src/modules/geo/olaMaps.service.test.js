import test from 'node:test';
import assert from 'node:assert/strict';
import { mapOlaPredictions } from './olaMaps.service.js';

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
