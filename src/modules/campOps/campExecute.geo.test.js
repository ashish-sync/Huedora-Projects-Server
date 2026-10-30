import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGpsCaptureInTime,
  applyGpsCaptureOutTime,
  distanceMeters,
  evaluateGpsAgainstCamp,
  executorSubmitBlockers,
  EXECUTOR_GPS_RADIUS_M,
} from './campExecute.service.js';

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

test('applyGpsCaptureInTime sets In Time from the phone clock string', () => {
  const camp = { inTime: '' };
  applyGpsCaptureInTime(camp, '9:02');
  assert.equal(camp.inTime, '09:02');
});

test('applyGpsCaptureInTime overwrites a previous In Time on recapture', () => {
  const camp = { inTime: '08:15' };
  applyGpsCaptureInTime(camp, '11:07');
  assert.equal(camp.inTime, '11:07');
});

test('applyGpsCaptureInTime ignores an empty or invalid clock', () => {
  const camp = { inTime: '08:15' };
  applyGpsCaptureInTime(camp, '');
  assert.equal(camp.inTime, '08:15');
  applyGpsCaptureInTime(camp, 'not-a-time');
  assert.equal(camp.inTime, '08:15');
});

test('applyGpsCaptureOutTime sets Out Time from the phone clock string', () => {
  const camp = { outTime: '' };
  applyGpsCaptureOutTime(camp, '11:05');
  assert.equal(camp.outTime, '11:05');
});

test('applyGpsCaptureOutTime overwrites a previous Out Time on recapture', () => {
  const camp = { outTime: '12:00' };
  applyGpsCaptureOutTime(camp, '13:40');
  assert.equal(camp.outTime, '13:40');
});

test('Activity Form submit does not require Out GPS Selfie', () => {
  const blockers = executorSubmitBlockers({
    inTime: '09:02',
    actualPatients: 0,
    rxCount: 0,
    executionDocuments: [
      { docType: 'doctor_form' },
      { docType: 'patient_form' },
      { docType: 'gps_selfie' },
    ],
    executorGps: { latitude: 19.1558, longitude: 72.8509 },
  });
  assert.equal(blockers.includes('Capture Out GPS Selfie (GO)'), false);
  assert.deepEqual(blockers, []);
});

test('Activity Form submit does not require Out Time', () => {
  const blockers = executorSubmitBlockers({
    inTime: '09:02',
    actualPatients: 0,
    rxCount: 0,
    executionDocuments: [
      { docType: 'doctor_form' },
      { docType: 'patient_form' },
      { docType: 'gps_selfie' },
      { docType: 'gps_selfie_out' },
    ],
    executorGps: { latitude: 19.1558, longitude: 72.8509 },
    executorGpsOut: { latitude: 19.1558, longitude: 72.8509 },
  });
  assert.equal(blockers.includes('Enter Out Time'), false);
  assert.deepEqual(blockers, []);
});

test('Activity Form submit still validates Out GPS when a GO selfie is captured', () => {
  const blockers = executorSubmitBlockers({
    inTime: '09:02',
    actualPatients: 0,
    rxCount: 0,
    executionDocuments: [
      { docType: 'doctor_form' },
      { docType: 'patient_form' },
      { docType: 'gps_selfie' },
      { docType: 'gps_selfie_out' },
    ],
    executorGps: { latitude: 19.1558, longitude: 72.8509 },
  });
  assert.ok(blockers.includes('Capture GPS location with the out selfie'));
});

test('Activity Form submit does not require mapped consumables when none were used', () => {
  const blockers = executorSubmitBlockers({
    inTime: '09:02',
    actualPatients: 0,
    rxCount: 0,
    executionDocuments: [
      { docType: 'doctor_form' },
      { docType: 'patient_form' },
      { docType: 'gps_selfie' },
      { docType: 'gps_selfie_out' },
    ],
    executorGps: { latitude: 19.1558, longitude: 72.8509 },
    executorGpsOut: { latitude: 19.1558, longitude: 72.8509 },
    consumablesUsed: [],
  }, [{ productId: 'p1', itemName: 'Gloves' }]);
  assert.deepEqual(blockers, []);
});
