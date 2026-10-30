import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PIN_CODE_MISSING_IN_MASTER,
  getRequestStageBlockers,
} from './campOps.requestValidation.js';

const completeCamp = {
  source: 'excel',
  clientName: 'Acme Pharma',
  campaignType: 'Cardio',
  campaignName: 'BMD',
  campDate: '2026-07-22',
  startTime: '09:00',
  endTime: '12:00',
  doctorName: 'Dr Sharma',
  doctorCode: 'D001',
  campAddress: '12 MG Road',
  pincode: '560001',
  state: 'Karnataka',
  district: 'Bengaluru Urban',
  city: 'Bengaluru',
  hq: 'Bengaluru',
  zone: 'South Zone',
  expectedPatients: 50,
  tmName: 'Ravi Kumar',
  tmPhone: '9876543210',
};

test('unknown PIN in bulk upload reports Pin Code Missing in Master instead of State or Zone', () => {
  const errors = getRequestStageBlockers({
    ...completeCamp,
    pincode: '999999',
    state: '',
    zone: '',
    pinMasterMissing: true,
  });
  assert.ok(errors.includes(PIN_CODE_MISSING_IN_MASTER));
  assert.equal(errors.includes('State is required'), false);
  assert.equal(errors.includes('Zone is required'), false);
});
