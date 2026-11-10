import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCampScopeFilter,
  computeClientOneKpis,
  hashClientOnePin,
  isClientOnePreviewToken,
  mintClientOnePin,
  programmeKeysFromMaster,
  signClientOneSession,
  toClientOneCampDto,
  verifyClientOneSessionToken,
} from './clientOne.service.js';
import { assertClientOneFeature, normalizeClientOneFeatures } from './clientOne.features.js';
import { misToCsv } from './clientOne.portal.js';

test('hashClientOnePin is stable and rejects empty', () => {
  assert.equal(hashClientOnePin('12345678'), hashClientOnePin('12345678'));
  assert.notEqual(hashClientOnePin('12345678'), hashClientOnePin('87654321'));
  assert.equal(hashClientOnePin(''), null);
});

test('mintClientOnePin returns numeric PIN of expected length', () => {
  const pin = mintClientOnePin(8);
  assert.match(pin, /^\d{8}$/);
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
      { status: 'executed', campDate: '2026-11-01', chargeableStatus: 'chargeable' },
      { status: 'approved', campDate: '2026-11-12' },
      { status: 'cancelled', campDate: '2026-11-05', cancellationBy: 'client' },
      { status: 'pending_review', campDate: '2026-11-08' },
    ],
    { from: '2026-11-01', to: '2026-11-30', now },
  );
  assert.equal(kpis.total, 4);
  assert.equal(kpis.executed, 1);
  assert.equal(kpis.approved, 1);
  assert.equal(kpis.cancelled, 1);
  assert.equal(kpis.cancelledByClient, 1);
  assert.equal(kpis.pending, 1);
  assert.equal(kpis.upcoming7Days, 1);
  assert.equal(kpis.chargeable, 1);
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
