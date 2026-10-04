import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, evaluateGpsAgainstCamp, EXECUTOR_GPS_RADIUS_M } from './campExecute.service.js';

test('distanceMeters approximates Andheri short walk', () => {
  // ~111m north of a point near Andheri
  const baseLat = 19.1197;
  const baseLng = 72.8468;
  const nearLat = 19.1207;
  const d = distanceMeters(baseLat, baseLng, nearLat, baseLng);
  assert.ok(d > 90 && d < 140, `expected ~111m, got ${d}`);
});

test('evaluateGpsAgainstCamp marks within 250m', () => {
  const camp = { latitude: 19.1197, longitude: 72.8468 };
  const ok = evaluateGpsAgainstCamp(camp, { latitude: 19.1200, longitude: 72.8468 });
  assert.equal(ok.withinRadius, true);
  assert.ok(ok.distanceMeters <= EXECUTOR_GPS_RADIUS_M);
});

test('evaluateGpsAgainstCamp marks outside radius', () => {
  const camp = { latitude: 19.1197, longitude: 72.8468 };
  const far = evaluateGpsAgainstCamp(camp, { latitude: 19.13, longitude: 72.8468 });
  assert.equal(far.withinRadius, false);
  assert.ok(far.distanceMeters > EXECUTOR_GPS_RADIUS_M);
});

test('evaluateGpsAgainstCamp allows missing camp coords', () => {
  const camp = { latitude: null, longitude: null };
  const gps = evaluateGpsAgainstCamp(camp, { latitude: 19.1197, longitude: 72.8468 });
  assert.equal(gps.withinRadius, null);
  assert.equal(gps.campHasCoordinates, false);
});
