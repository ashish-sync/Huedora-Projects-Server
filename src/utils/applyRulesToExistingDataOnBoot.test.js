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
