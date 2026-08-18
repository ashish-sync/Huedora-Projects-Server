import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCampDuplicateKey,
  campaignTypesMatch,
  clientsMatch,
  doctorsMatch,
  DUPLICATE_CAMP_MESSAGE,
  formatDuplicateCampMessage,
  normalizeCampStartTime,
  normalizeDoctorName,
  startTimesMatch,
} from './campDuplicate.js';

test('buildCampDuplicateKey uses client + doctor + division + date + start time', () => {
  const key = buildCampDuplicateKey({
    clientName: 'Acme Pharma',
    doctorName: 'Dr. Rajesh Kumar',
    campaignType: 'Screening',
    campDate: '2026-08-15',
    startTime: '09:00',
  });
  assert.ok(key);
  assert.equal(
    key,
    buildCampDuplicateKey({
      clientName: 'Acme Pharma',
      doctorName: 'Dr. Rajesh Kumar',
      campaignType: 'Screening',
      campDate: '2026-08-15',
      startTime: '09:00',
    }),
  );
});

test('buildCampDuplicateKey requires all five parts', () => {
  assert.equal(
    buildCampDuplicateKey({
      clientName: 'Acme',
      campaignType: 'Screening',
      campDate: '2026-08-15',
      startTime: '09:00',
    }),
    '',
  );
  assert.equal(
    buildCampDuplicateKey({
      clientName: 'Acme',
      doctorName: 'Rajesh Kumar',
      campaignType: 'Screening',
      startTime: '09:00',
    }),
    '',
  );
});

test('different doctors are not the same duplicate key', () => {
  const a = buildCampDuplicateKey({
    clientName: 'Acme',
    doctorName: 'Rajesh Kumar',
    campaignType: 'Screening',
    campDate: '2026-08-15',
    startTime: '09:00',
  });
  const b = buildCampDuplicateKey({
    clientName: 'Acme',
    doctorName: 'Anita Desai',
    campaignType: 'Screening',
    campDate: '2026-08-15',
    startTime: '09:00',
  });
  assert.notEqual(a, b);
});

test('different start times are not the same duplicate key', () => {
  const morning = buildCampDuplicateKey({
    clientId: 'c1',
    doctorName: 'Rajesh Kumar',
    campaignType: 'Oncology',
    campDate: '2026-08-15',
    startTime: '09:00',
  });
  const noon = buildCampDuplicateKey({
    clientId: 'c1',
    doctorName: 'Rajesh Kumar',
    campaignType: 'Oncology',
    campDate: '2026-08-15',
    startTime: '14:00',
  });
  assert.notEqual(morning, noon);
});

test('normalizeDoctorName only trims exact doctor value', () => {
  assert.equal(normalizeDoctorName('  Dr. Rajesh Kumar  '), 'Dr. Rajesh Kumar');
  assert.equal(normalizeDoctorName('Doctor Anita Desai'), 'Doctor Anita Desai');
});

test('normalizeCampStartTime only trims exact time value', () => {
  assert.equal(normalizeCampStartTime(' 09:00 '), '09:00');
  assert.equal(normalizeCampStartTime('9.00 AM'), '9.00 AM');
});

test('campaignTypesMatch, startTimesMatch, and doctorsMatch require exact values after trim', () => {
  assert.equal(
    campaignTypesMatch({ campaignType: 'Screening' }, { campaignType: 'screening' }),
    false,
  );
  assert.equal(
    startTimesMatch({ startTime: '9:00 AM' }, { startTime: '09:00' }),
    false,
  );
  assert.equal(
    doctorsMatch({ doctorName: 'Dr. Rajesh Kumar' }, { doctorName: 'rajesh kumar' }),
    false,
  );
});

test('clientsMatch prefers id then name', () => {
  assert.equal(
    clientsMatch({ _id: 'abc' }, { clientId: 'abc', clientName: 'Other' }),
    true,
  );
  assert.equal(
    clientsMatch({ name: 'Acme Pharma' }, { clientName: 'acme pharma' }),
    false,
  );
  assert.equal(
    clientsMatch({ name: 'Acme' }, { clientName: 'Other' }),
    false,
  );
});

test('formatDuplicateCampMessage uses canonical duplicate entry text', () => {
  assert.equal(
    formatDuplicateCampMessage({ campId: 'CAMP-1' }),
    DUPLICATE_CAMP_MESSAGE,
  );
});
