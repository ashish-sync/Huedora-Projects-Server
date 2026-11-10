import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCampScopeFilter,
  computeClientOneKpis,
  hashClientOnePin,
  isClientOnePreviewToken,
  mintClientOnePin,
  normalizeClientOnePin,
  programmeKeysFromMaster,
  resolveClientOnePinInput,
  signClientOneSession,
  toClientOneCampDto,
  verifyClientOneSessionToken,
} from './clientOne.service.js';
import { assertClientOneFeature, normalizeClientOneFeatures } from './clientOne.features.js';
import { misToCsv } from './clientOne.portal.js';

test('hashClientOnePin is stable and rejects empty or non-6-digit values', () => {
  assert.equal(hashClientOnePin('123456'), hashClientOnePin('123456'));
  assert.notEqual(hashClientOnePin('123456'), hashClientOnePin('654321'));
  assert.equal(hashClientOnePin(''), null);
  assert.equal(hashClientOnePin('12345'), null);
  assert.equal(hashClientOnePin('1234567'), null);
});

test('mintClientOnePin returns numeric PIN of expected length', () => {
  const pin = mintClientOnePin();
  assert.match(pin, /^\d{6}$/);
});

test('resolveClientOnePinInput accepts custom 6-digit PIN or auto-generates', () => {
  assert.equal(normalizeClientOnePin('12-34-56'), '123456');
  assert.equal(resolveClientOnePinInput('654321'), '654321');
  assert.match(resolveClientOnePinInput(''), /^\d{6}$/);
  assert.throws(() => resolveClientOnePinInput('12345'), /6 digits/i);
});

test('programmeKeysFromMaster maps Client Master programme dimensions', () => {
  const keys = programmeKeysFromMaster({
    clientId: 'c1',
    clientName: 'Acme',
    programName: 'Oncology',
    campName: 'bmd',
  });
  assert.equal(keys.clientId, 'c1');
  assert.equal(keys.programName, 'Oncology');
  assert.equal(keys.campName, 'BMD');
});

test('buildCampScopeFilter forces client + division + method', () => {
  const filter = buildCampScopeFilter({
    clientId: 'c1',
    programName: 'Oncology',
    campName: 'BMD',
  });
  assert.equal(filter.clientId, 'c1');
  assert.equal(filter.campaignType, 'Oncology');
  assert.equal(filter.campaignName, 'BMD');
  assert.equal(filter.isDeleted, false);
});

test('toClientOneCampDto strips finance fields', () => {
  const dto = toClientOneCampDto({
    _id: 'camp-1',
    campId: '26-11-0001',
    campDate: '2026-11-10',
    status: 'approved',
    hcwName: 'Dr Rao',
    hcwContact: '9999999999',
    payoutAmount: 5000,
    financePaymentStatus: 'paid',
    paidAmount: 5000,
  });
  assert.equal(dto.campId, '26-11-0001');
  assert.equal(dto.hcwName, 'Dr Rao');
  assert.equal(dto.payoutAmount, undefined);
  assert.equal(dto.financePaymentStatus, undefined);
  assert.equal(dto.paidAmount, undefined);
});

test('computeClientOneKpis counts statuses and upcoming', () => {
  const now = new Date('2026-11-10T12:00:00.000Z');
  const kpis = computeClientOneKpis(
    [
      {
        status: 'executed',
        executionStatus: 'Camp Completed',
        campDate: '2026-11-01',
        chargeableStatus: 'Chargeable',
        actualPatients: 12,
        doctorName: 'Dr A',
      },
      { status: 'approved', executionStatus: 'Camp Scheduled', campDate: '2026-11-12', doctorName: 'Dr B' },
      {
        status: 'cancelled',
        executionStatus: 'Cancelled by Client',
        campDate: '2026-11-05',
        cancelledBy: 'brand',
      },
      { status: 'pending_review', campDate: '2026-11-08', doctorName: 'Dr A' },
    ],
    { from: '2026-11-01', to: '2026-11-30', now },
  );
  assert.equal(kpis.total, 4);
  assert.equal(kpis.campCount, 4);
  assert.equal(kpis.patientsScreened, 12);
  assert.equal(kpis.uniqueDoctors, 2);
  assert.equal(kpis.executed, 1);
  assert.equal(kpis.approved, 1);
  assert.equal(kpis.cancelled, 1);
  assert.equal(kpis.cancelledByClient, 1);
  assert.equal(kpis.pending, 1);
  assert.equal(kpis.upcoming7Days, 1);
  assert.equal(kpis.chargeable, 1);
});

test('computeClientOneDashboardAnalytics uses Camp One business buckets', async () => {
  const { computeClientOneDashboardAnalytics } = await import('./clientOne.service.js');
  const analytics = computeClientOneDashboardAnalytics([
    {
      status: 'executed',
      executionStatus: 'Camp Completed',
      campDate: '2026-11-10',
      requestDate: '2026-11-01',
      chargeableStatus: 'Chargeable',
      startTime: '09:00',
      inTime: '09:02',
      outTime: '12:00',
      clientMasterCampDuration: '4:00',
      extraHours: 1,
      actualPatients: 20,
      doctorName: 'Dr Rao',
      state: 'Bihar',
      fieldPersonName: 'Vivek Sharma',
    },
    {
      status: 'executed',
      executionStatus: 'Marked Executed',
      campDate: '2026-11-12',
      requestDate: '2026-11-10',
      chargeableStatus: 'Non-Chargeable',
      startTime: '09:00',
      inTime: '09:40',
      outTime: '19:00',
      clientMasterCampDuration: '4:00',
      extraHours: 5,
      punctuality: 'Poor',
      actualPatients: 8,
      doctorName: 'Dr Rao',
      state: 'Bihar',
      fieldPersonName: 'Vivek Sharma',
    },
    {
      status: 'approved',
      executionStatus: 'Camp Scheduled',
      campDate: '2026-11-15',
      requestDate: '2026-11-14',
      chargeableStatus: '',
      doctorName: 'Dr Planned',
      fieldPersonName: 'Ravi Gupta',
      state: 'Maharashtra',
    },
    {
      status: 'cancelled',
      executionStatus: 'Cancelled by Tylo',
      campDate: '2026-11-08',
      cancelledBy: 'khw',
      closureReasonCategory: 'Resource Issue',
      closureSubReason: 'hcw_unavailability',
      closureSubReasonLabel: 'HCW Unavailability',
      doctorName: 'Dr Mehta',
      fieldPersonName: 'Ravi Gupta',
      state: 'Maharashtra',
      actualPatients: 0,
    },
  ]);
  assert.equal(analytics.charts.requestTimeline.slices.find((s) => s.label === '5 or more Days')?.value, 1);
  assert.equal(analytics.charts.requestTimeline.slices.find((s) => s.label === 'Less than 5 Days')?.value, 2);
  assert.equal(analytics.charts.finalBilling.slices.find((s) => s.label === 'Chargeable')?.value, 1);
  assert.equal(analytics.charts.finalBilling.slices.find((s) => s.label === 'Non-Chargeable')?.value, 1);
  assert.equal(analytics.charts.finalBilling.slices.find((s) => s.label === 'Planned')?.value, 2);
  assert.equal(analytics.charts.punctuality.slices.find((s) => s.label === 'Good')?.value, 1);
  assert.equal(analytics.charts.punctuality.slices.find((s) => s.label === 'Poor')?.value, 1);
  assert.equal(analytics.charts.punctuality.slices.find((s) => s.label === 'Cancelled')?.value, 1);
  assert.equal(analytics.charts.extraHours.slices.find((s) => s.label === 'Within 4 Hours')?.value, 1);
  assert.equal(analytics.charts.extraHours.slices.find((s) => s.label === 'Beyond 4 Hours')?.value, 1);
  assert.equal(analytics.charts.executedClinics.slices.find((s) => s.label === 'Executed')?.value, 2);
  assert.equal(analytics.charts.executedClinics.slices.find((s) => s.label === 'Cancelled by Tylo')?.value, 1);
  assert.equal(analytics.charts.tyloCancellation.slices[0]?.label, 'HCW Unavailability');
  assert.equal(analytics.leaderboards.doctors[0]?.name, 'Dr Rao');
  assert.equal(analytics.leaderboards.doctors[0]?.patients, 28);
  assert.equal(analytics.leaderboards.mrs[0]?.name, 'Vivek Sharma');
});

test('normalizeClientOneFeatures defaults all capabilities on', () => {
  const features = normalizeClientOneFeatures(null);
  assert.equal(features.dashboard, true);
  assert.equal(features.poUpload, true);
  assert.equal(normalizeClientOneFeatures({ invoices: false }).invoices, false);
});

test('assertClientOneFeature blocks disabled capabilities', () => {
  assert.throws(
    () => assertClientOneFeature({ features: { invoices: false } }, 'invoices'),
    /not enabled/i,
  );
});

test('misToCsv includes programme header and camp rows', () => {
  const csv = misToCsv({
    client: { name: 'Acme', programName: 'Oncology', campName: 'BMD' },
    from: '2026-11-01',
    to: '2026-11-30',
    kpis: { total: 1, executed: 1 },
    camps: [{ campId: '26-11-0001', campDate: '2026-11-10', status: 'executed', hcwName: 'Dr Rao', city: 'Pune' }],
  });
  assert.match(csv, /Acme/);
  assert.match(csv, /26-11-0001/);
  assert.match(csv, /Total camps/);
});

test('signClientOneSession marks preview tokens distinctly from external PIN sessions', () => {
  const access = {
    accessId: 'ABC123',
    clientMasterId: 'master-1',
    clientId: 'client-1',
    clientName: 'Acme',
    programName: 'Oncology',
    campName: 'BMD',
    features: null,
  };
  const external = signClientOneSession(access);
  const preview = signClientOneSession(access, {
    preview: true,
    actor: { email: 'admin@tylo.local' },
  });
  assert.equal(external.mode, 'external');
  assert.equal(preview.mode, 'preview');
  const decodedExternal = verifyClientOneSessionToken(external.token);
  const decodedPreview = verifyClientOneSessionToken(preview.token);
  assert.equal(decodedExternal.typ, 'client_one');
  assert.equal(decodedPreview.typ, 'client_one_preview');
  assert.equal(isClientOnePreviewToken(decodedPreview), true);
  assert.equal(isClientOnePreviewToken(decodedExternal), false);
});
