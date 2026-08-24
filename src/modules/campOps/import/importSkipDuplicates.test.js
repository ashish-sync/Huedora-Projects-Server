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
} from '../../../store/persistence.js';
import { attachDuplicateKey } from '../campDuplicate.js';
import {
  findImportDuplicateToSkip,
  resolveImportDuplicateRow,
  partitionImportRowsByDuplicate,
} from './importSkipDuplicates.js';

const CLIENT = { _id: 'client-1', name: 'Acme Pharma' };

let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-skip-dup-'));
  configurePersistence({ backend: 'file', dataDirectory: tempDir });
  await hydratePersistence();
});

test.after(async () => {
  clearPersistenceCache();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test('resolveImportDuplicateRow uses schedule default start time', () => {
  const row = resolveImportDuplicateRow({
    doctorName: 'Rajesh',
    campaignType: 'Screening',
    campDate: '2026-08-20',
    startTime: '',
  });
  assert.equal(row.startTime, '09:00');
});

test('import duplicate skip leaves existing camp fields unchanged', async () => {
  const existing = {
    _id: 'camp-keep',
    campId: '26-08-keep',
    clientId: CLIENT._id,
    clientName: CLIENT.name,
    doctorName: 'Dr. Rajesh Kumar',
    campaignType: 'Screening',
    campDate: '2026-08-20',
    startTime: '09:00',
    remarks: 'ORIGINAL_REMARKS_DO_NOT_TOUCH',
    city: 'Mumbai',
    status: 'approved',
    isDeleted: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
  attachDuplicateKey(existing, { client: CLIENT });
  clearPersistenceCache();
  await saveCollection('camp_ops_camps', [existing], { allowDestructiveSync: true });

  const before = structuredClone(existing);
  const hit = await findImportDuplicateToSkip({
    client: CLIENT,
    row: {
      clientName: CLIENT.name,
      doctorName: 'Rajesh Kumar',
      campaignType: 'screening',
      campDate: '2026-08-20',
      startTime: '9:00',
      remarks: 'SHOULD_NOT_WRITE',
      city: 'Pune',
    },
  });

  assert.ok(hit);
  assert.equal(hit.duplicate.campId, '26-08-keep');

  const after = (await loadCollection('camp_ops_camps')).find((r) => r._id === 'camp-keep');
  assert.equal(after.remarks, before.remarks);
  assert.equal(after.city, before.city);
  assert.equal(after.status, before.status);
  assert.equal(after.doctorName, before.doctorName);
  assert.equal(after.startTime, before.startTime);
});

test('partitionImportRowsByDuplicate never marks duplicates as creatable', async () => {
  const existing = {
    _id: 'camp-a',
    campId: '26-08-a',
    clientId: CLIENT._id,
    clientName: CLIENT.name,
    doctorName: 'Anita Desai',
    campaignType: 'Oncology',
    campDate: '2026-09-01',
    startTime: '14:00',
    isDeleted: false,
  };
  attachDuplicateKey(existing, { client: CLIENT });
  clearPersistenceCache();
  await saveCollection('camp_ops_camps', [existing], { allowDestructiveSync: true });

  const { creatable, skippedDuplicates } = await partitionImportRowsByDuplicate({
    rows: [
      {
        rowNumber: 1,
        clientName: CLIENT.name,
        doctorName: 'Anita Desai',
        campaignType: 'Oncology',
        campDate: '2026-09-01',
        startTime: '14:00',
      },
      {
        rowNumber: 2,
        clientName: CLIENT.name,
        doctorName: 'Other Doctor',
        campaignType: 'Oncology',
        campDate: '2026-09-01',
        startTime: '14:00',
      },
    ],
    resolveClient: async () => CLIENT,
  });

  assert.equal(skippedDuplicates.length, 1);
  assert.equal(skippedDuplicates[0].rowNumber, 1);
  assert.equal(creatable.length, 1);
  assert.equal(creatable[0].row.rowNumber, 2);
});
