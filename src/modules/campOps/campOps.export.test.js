import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  configurePersistence,
  clearPersistenceCache,
  hydratePersistence,
  saveCollection,
} from '../../store/persistence.js';
import {
  applyExportProgramScope,
  serializeExportTemplate,
  fetchCampsForExport,
  filterCampsForExportPredicates,
  campIdsFromRows,
  diffCampIdSets,
  normalizeExportQuery,
} from './campOps.export.js';
import { buildCampFilter } from './campOps.helpers.js';
import { cheapRequestReviewStatus } from './campOps.listDto.js';

let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camp-export-'));
  configurePersistence({ backend: 'file', dataDirectory: tempDir });
  await hydratePersistence();
});

test.after(async () => {
  clearPersistenceCache();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test('serializeExportTemplate exposes Mongo _id as id for the UI', () => {
  const row = serializeExportTemplate({
    _id: 'tmpl-1',
    name: 'Ops sheet',
    columns: ['campId'],
  });
  assert.equal(row.id, 'tmpl-1');
  assert.equal(row._id, 'tmpl-1');
  assert.equal(row.name, 'Ops sheet');
});

test('applyExportProgramScope keeps only camps for assigned programs', () => {
  const scoped = [{ clientId: 'client-a', programName: 'Ortho', campName: 'BMD' }];
  const rows = [
    { clientId: 'client-a', campaignType: 'Ortho', campaignName: 'BMD' },
    { clientId: 'client-a', campaignType: 'Ortho', campaignName: 'Screening' },
    { clientId: 'client-b', campaignType: 'Ortho', campaignName: 'BMD' },
  ];
  const out = applyExportProgramScope(rows, scoped);
  assert.equal(out.length, 1);
  assert.equal(out[0].campaignName, 'BMD');
  assert.equal(out[0].clientId, 'client-a');
});

test('applyExportProgramScope leaves unrestricted users unfiltered', () => {
  const rows = [
    { clientId: 'client-a', campaignType: 'Ortho', campaignName: 'BMD' },
    { clientId: 'client-b', campaignType: 'Cardio', campaignName: 'ECG' },
  ];
  assert.equal(applyExportProgramScope(rows, null).length, 2);
  assert.equal(applyExportProgramScope(rows, []).length, 0);
});

test('diffCampIdSets reports missing export IDs', () => {
  const diff = diffCampIdSets(['26-11-0001', '26-11-0002', '26-11-0003'], ['26-11-0001', '26-11-0003']);
  assert.deepEqual(diff.missingFromExport, ['26-11-0002']);
  assert.deepEqual(diff.extraInExport, []);
});

function completeRequestFields(overrides = {}) {
  return {
    doctorName: 'Dr Export Test',
    doctorCode: 'DOC-1',
    clientName: 'Export Co',
    clientId: 'client-export',
    campaignType: 'Screening',
    campaignName: 'BMD',
    campAddress: '12 Test Road',
    city: 'Mumbai',
    state: 'Maharashtra',
    district: 'Mumbai Suburban',
    pincode: '400001',
    zone: 'West Zone',
    hq: 'Mumbai HQ',
    source: 'dashboard',
    expectedPatients: 20,
    startTime: '09:00',
    endTime: '12:00',
    speciality: 'General Practitioner',
    fieldPersonName: 'Field Agent',
    fieldPersonPhone: '9999999999',
    ...overrides,
  };
}

test('export predicates match list cheapRequestReviewStatus', () => {
  const pending = completeRequestFields({
    campId: '29-01-0001',
    status: 'pending_review',
    submittedAt: new Date().toISOString(),
    lifecycleStage: 'request',
    isDeleted: false,
    campDate: '2029-01-10',
  });
  const overdueStored = completeRequestFields({
    campId: '29-01-0002',
    status: 'pending_review',
    submittedAt: '2020-01-01T00:00:00.000Z',
    lifecycleStage: 'request',
    isDeleted: false,
    campDate: '2029-01-11',
  });
  const rows = [pending, overdueStored];
  const filtered = filterCampsForExportPredicates(rows, { requestReviewStatus: 'review_overdue' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].campId, '29-01-0002');
  assert.equal(cheapRequestReviewStatus(overdueStored, 'review_overdue'), true);
});

test('fetchCampsForExport returns all matching IDs (no pre-cap before predicates)', async () => {
  clearPersistenceCache();
  const camps = [];
  for (let i = 1; i <= 12; i += 1) {
    const even = i % 2 === 0;
    camps.push(completeRequestFields({
      _id: `exp-${i}`,
      campId: `29-06-${String(i).padStart(4, '0')}`,
      campDate: `2029-06-${String(Math.min(i, 28)).padStart(2, '0')}`,
      status: even ? 'pending_review' : 'approved',
      submittedAt: new Date().toISOString(),
      lifecycleStage: even ? 'request' : 'assignment',
      isDeleted: false,
      createdAt: `2029-06-${String(Math.min(i, 28)).padStart(2, '0')}T00:00:00.000Z`,
    }));
  }
  // Soft-deleted and archived must stay out of default export
  camps.push(completeRequestFields({
    _id: 'exp-del',
    campId: '29-06-0099',
    status: 'pending_review',
    submittedAt: new Date().toISOString(),
    lifecycleStage: 'request',
    isDeleted: true,
    campDate: '2029-06-15',
  }));
  camps.push(completeRequestFields({
    _id: 'exp-arch',
    campId: '29-06-0098',
    status: 'pending_review',
    submittedAt: new Date().toISOString(),
    lifecycleStage: 'request',
    isDeleted: false,
    archivedAt: '2029-06-01T00:00:00.000Z',
    campDate: '2029-06-15',
  }));

  await saveCollection('camp_ops_camps', camps, { allowDestructiveSync: true });

  const req = { user: { _id: 'admin', systemRole: 'Admin' }, query: {} };
  const scopeCampFilter = async (_req, filter) => filter;

  const listFilter = buildCampFilter({
    lifecycleStage: 'request',
    requestReviewStatus: 'review_pending',
  });
  assert.equal(listFilter.isDeleted, false);

  const result = await fetchCampsForExport(
    req,
    { lifecycleStage: 'request', requestReviewStatus: 'review_pending' },
    { scopeCampFilter },
  );

  const exportIds = campIdsFromRows(result.camps);
  assert.ok(exportIds.includes('29-06-0002'));
  assert.ok(exportIds.includes('29-06-0012'));
  assert.equal(exportIds.includes('29-06-0001'), false);
  assert.equal(exportIds.includes('29-06-0099'), false);
  assert.equal(exportIds.includes('29-06-0098'), false);
  assert.equal(result.truncated, false);
  assert.equal(result.matchedCount, exportIds.length);

  // Parity: every export ID would also pass list predicate
  for (const camp of result.camps) {
    assert.equal(cheapRequestReviewStatus(camp, 'review_pending'), true);
  }
});

test('normalizeExportQuery coerces overdue boolean', () => {
  assert.equal(normalizeExportQuery({ overdue: true }).overdue, '1');
  assert.equal(normalizeExportQuery({ overdue: false }).overdue, undefined);
});

test('cancelled and rejected remain exportable when filters ask for them', async () => {
  clearPersistenceCache();
  await saveCollection(
    'camp_ops_camps',
    [
      {
        _id: 'c-cancel',
        campId: '29-07-0001',
        status: 'cancelled',
        lifecycleStage: 'financial',
        isDeleted: false,
        campDate: '2029-07-01',
        assignmentRefusalReason: 'Cancelled by Tylo',
        executionStatus: 'Cancelled by Tylo',
      },
      {
        _id: 'c-reject',
        campId: '29-07-0002',
        status: 'rejected',
        lifecycleStage: 'request',
        isDeleted: false,
        campDate: '2029-07-02',
        requestReviewStatus: 'request_rejected',
      },
      {
        _id: 'c-ok',
        campId: '29-07-0003',
        status: 'approved',
        lifecycleStage: 'execution',
        isDeleted: false,
        campDate: '2029-07-03',
      },
    ],
    { allowDestructiveSync: true },
  );

  const req = { user: { _id: 'admin' }, query: {} };
  const scopeCampFilter = async (_req, filter) => filter;

  const cancelled = await fetchCampsForExport(
    req,
    { status: 'cancelled' },
    { scopeCampFilter },
  );
  assert.deepEqual(campIdsFromRows(cancelled.camps), ['29-07-0001']);

  const rejected = await fetchCampsForExport(
    req,
    { lifecycleStage: 'request', requestReviewStatus: 'request_rejected' },
    { scopeCampFilter },
  );
  assert.deepEqual(campIdsFromRows(rejected.camps), ['29-07-0002']);

  const financialLive = await fetchCampsForExport(
    req,
    { lifecycleStage: 'financial', excludeBoardCancelled: '1' },
    { scopeCampFilter },
  );
  assert.equal(campIdsFromRows(financialLive.camps).includes('29-07-0001'), false);
});
