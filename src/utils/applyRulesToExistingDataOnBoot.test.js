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
  loadCollection,
} from '../store/persistence.js';
import {
  recomputeCampDuplicateKeys,
  refreshDocumentTemplateDatePlaceholders,
  backfillExistingCampBusinessLogic,
} from './applyRulesToExistingDataOnBoot.js';
import { buildCampDuplicateKey } from '../modules/campOps/campDuplicate.js';

let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-boot-'));
  configurePersistence({ backend: 'file', dataDirectory: tempDir });
  await hydratePersistence();
});

test.after(async () => {
  clearPersistenceCache();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test('recomputeCampDuplicateKeys normalizes legacy start times on existing camps', async () => {
  clearPersistenceCache();
  await saveCollection(
    'camp_ops_camps',
    [
      {
        _id: 'c1',
        campId: '26-08-0001',
        clientId: 'client-1',
        clientName: 'Acme',
        doctorName: 'Dr. Rajesh Kumar',
        campaignType: 'Screening',
        campDate: '2026-08-20',
        startTime: '9:00',
        duplicateKey: 'stale-unnormalized-key',
        isDeleted: false,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    { allowDestructiveSync: true },
  );

  const result = await recomputeCampDuplicateKeys({ dryRun: false });
  assert.equal(result.updated, 1);
  const rows = await loadCollection('camp_ops_camps');
  const expected = buildCampDuplicateKey({
    clientId: 'client-1',
    doctorName: 'Dr. Rajesh Kumar',
    campaignType: 'Screening',
    campDate: '2026-08-20',
    startTime: '09:00',
  });
  assert.equal(rows[0].duplicateKey, expected);
});

test('refreshDocumentTemplateDatePlaceholders upgrades Todays Date to type date', async () => {
  clearPersistenceCache();
  await saveCollection(
    'document_templates',
    [
      {
        _id: 't1',
        name: 'Service Agreement',
        isDeleted: false,
        placeholders: [
          { key: 'todays_date', label: 'Todays Date', type: 'text', inner: 'Todays Date' },
          { key: 'remarks', label: 'Remarks', type: 'text', inner: 'Remarks' },
        ],
      },
    ],
    { allowDestructiveSync: true },
  );

  const result = await refreshDocumentTemplateDatePlaceholders({ dryRun: false });
  assert.equal(result.updated, 1);
  const rows = await loadCollection('document_templates');
  assert.equal(rows[0].placeholders[0].type, 'date');
  assert.equal(rows[0].placeholders[1].type, 'text');
});

test('backfillExistingCampBusinessLogic updates Extra hours on legacy camps without rewriting campId', async () => {
  clearPersistenceCache();
  await saveCollection(
    'camp_ops_client_masters',
    [
      {
        _id: 'cm1',
        clientId: 'client-1',
        clientName: 'Acme',
        programName: 'Screening',
        campName: 'BMD',
        campDuration: '4:00',
        otUnit: 400,
        executedCampUnit: 5000,
        isActive: true,
        isDeleted: false,
      },
    ],
    { allowDestructiveSync: true },
  );
  await saveCollection(
    'camp_ops_camps',
    [
      {
        _id: 'c-legacy',
        campId: '26-08-0001',
        clientId: 'client-1',
        clientName: 'Acme',
        campaignType: 'Screening',
        campaignName: 'BMD',
        inTime: '09:00',
        outTime: '15:00',
        durationHours: 3,
        extraHours: 3,
        overtimeRevenue: 1200,
        campRevenue: 5000,
        travelRevenue: 0,
        otherRevenue: 0,
        totalRevenue: 6200,
        campAmount: 0,
        executionStatus: 'Camp Completed',
        isDeleted: false,
      },
    ],
    { allowDestructiveSync: true },
  );

  const first = await backfillExistingCampBusinessLogic({ dryRun: false });
  assert.equal(first.updated, 1);
  const rows = await loadCollection('camp_ops_camps');
  assert.equal(rows[0].campId, '26-08-0001');
  assert.equal(rows[0].clientMasterCampDuration, '4:00');
  assert.equal(rows[0].extraHours, 2);
  assert.equal(rows[0].overtimeRevenue, 800);

  const second = await backfillExistingCampBusinessLogic({ dryRun: false });
  assert.equal(second.updated, 0);
});
