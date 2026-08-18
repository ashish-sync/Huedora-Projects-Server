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
import { CampOpsCamp } from './campOps.model.js';
import {
  assertNoDuplicateCamp,
  assertNoDuplicateOnCampSave,
  attachDuplicateKey,
  CampDuplicateError,
  createCampEnsuringNoDuplicate,
  DUPLICATE_CAMP_MESSAGE,
  findExistingDuplicateCamp,
} from './campDuplicate.js';
import { createCampFromRow } from './communications/campCreation.service.js';

const CLIENT = { _id: 'client-1', name: 'Acme Pharma' };
const BASE_ROW = {
  clientName: 'Acme Pharma',
  doctorName: 'Dr. Rajesh Kumar',
  campaignName: 'BMD',
  campaignType: 'Screening',
  campDate: '2026-09-15',
  startTime: '09:00',
};

let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camp-dup-'));
  configurePersistence({ backend: 'file', dataDirectory: tempDir });
  await hydratePersistence();
});

test.after(async () => {
  clearPersistenceCache();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function resetCamps(rows = []) {
  clearPersistenceCache();
  await saveCollection('camp_ops_camps', rows, { allowDestructiveSync: true });
  await saveCollection('camp_ops_clients', [], { allowDestructiveSync: true });
  await saveCollection('camp_ops_client_masters', [], { allowDestructiveSync: true });
}

function seedCamp(overrides = {}) {
  const doc = {
    _id: overrides._id || `camp-${Math.random().toString(36).slice(2, 8)}`,
    campId: overrides.campId || '26-09-0001',
    clientId: CLIENT._id,
    clientName: CLIENT.name,
    doctorName: BASE_ROW.doctorName,
    campaignName: BASE_ROW.campaignName,
    campaignType: BASE_ROW.campaignType,
    campDate: BASE_ROW.campDate,
    startTime: BASE_ROW.startTime,
    endTime: '12:00',
    lifecycleStage: 'request',
    status: 'pending_review',
    isDeleted: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
  attachDuplicateKey(doc, { client: CLIENT });
  return doc;
}

test('duplicate detection applies regardless of status or lifecycle stage', async () => {
  const statuses = ['pending_review', 'approved', 'executed', 'cancelled', 'rejected'];
  const stages = ['request', 'assignment', 'execution', 'financial'];

  for (const status of statuses) {
    for (const lifecycleStage of stages) {
      await resetCamps([seedCamp({ status, lifecycleStage, campId: `26-09-${status}-${lifecycleStage}` })]);
      const duplicate = await findExistingDuplicateCamp({ client: CLIENT, row: BASE_ROW });
      assert.ok(duplicate, `expected duplicate for status=${status} stage=${lifecycleStage}`);
    }
  }
});

test('legacy camps without duplicateKey are still detected', async () => {
  const legacy = seedCamp({ campId: '26-09-legacy' });
  delete legacy.duplicateKey;
  await resetCamps([legacy]);

  const duplicate = await findExistingDuplicateCamp({ client: CLIENT, row: BASE_ROW });
  assert.equal(duplicate?.campId, '26-09-legacy');
});

test('edit excludes the current camp id from duplicate detection', async () => {
  const existing = seedCamp({ _id: 'edit-me', campId: '26-09-edit' });
  await resetCamps([existing]);

  await assertNoDuplicateOnCampSave(existing, { client: CLIENT });

  const duplicate = await findExistingDuplicateCamp({
    client: CLIENT,
    row: BASE_ROW,
    excludeId: 'edit-me',
    excludeCampId: '26-09-edit',
  });
  assert.equal(duplicate, null);
});

test('edit that collides with another camp is blocked', async () => {
  const first = seedCamp({ _id: 'first', campId: '26-09-first' });
  const second = seedCamp({
    _id: 'second',
    campId: '26-09-second',
    doctorName: 'Dr. Anita Desai',
    startTime: '14:00',
  });
  attachDuplicateKey(second, { client: CLIENT });
  await resetCamps([first, second]);

  second.doctorName = BASE_ROW.doctorName;
  second.startTime = BASE_ROW.startTime;
  attachDuplicateKey(second, { client: CLIENT });

  await assert.rejects(
    () => assertNoDuplicateOnCampSave(second, { client: CLIENT }),
    (err) => err instanceof CampDuplicateError && err.message === DUPLICATE_CAMP_MESSAGE,
  );
});

test('createCampEnsuringNoDuplicate blocks dashboard-style create', async () => {
  await resetCamps([seedCamp({ campId: '26-09-existing' })]);

  await assert.rejects(
    () => createCampEnsuringNoDuplicate(
      CampOpsCamp,
      {
        campId: '26-09-new',
        clientId: CLIENT._id,
        clientName: CLIENT.name,
        ...BASE_ROW,
        endTime: '12:00',
        lifecycleStage: 'request',
        status: 'pending_review',
        source: 'dashboard',
      },
      { client: CLIENT, row: BASE_ROW },
    ),
    (err) => err instanceof CampDuplicateError,
  );
});

test('createCampFromRow blocks communications ingest create', async () => {
  await resetCamps([seedCamp({ campId: '26-09-email' })]);

  await assert.rejects(
    () => createCampFromRow({
      row: BASE_ROW,
      client: CLIENT,
      createdBy: { _id: 'user-1', email: 'ops@tylo.local' },
      source: 'email',
    }),
    (err) => err instanceof CampDuplicateError && err.message === DUPLICATE_CAMP_MESSAGE,
  );
});

test('assertNoDuplicateCamp uses canonical duplicate entry message', async () => {
  await resetCamps([seedCamp({ campId: '26-09-msg' })]);

  await assert.rejects(
    () => assertNoDuplicateCamp({ client: CLIENT, row: BASE_ROW }),
    (err) => err instanceof CampDuplicateError && err.message === DUPLICATE_CAMP_MESSAGE,
  );
});

test('concurrent duplicate submissions allow only one create', async () => {
  await resetCamps([]);

  const payload = {
    campId: '26-09-a',
    clientId: CLIENT._id,
    clientName: CLIENT.name,
    ...BASE_ROW,
    endTime: '12:00',
    lifecycleStage: 'request',
    status: 'pending_review',
    source: 'dashboard',
  };

  const results = await Promise.allSettled([
    createCampEnsuringNoDuplicate(CampOpsCamp, { ...payload, campId: '26-09-a' }, { client: CLIENT, row: BASE_ROW }),
    createCampEnsuringNoDuplicate(CampOpsCamp, { ...payload, campId: '26-09-b' }, { client: CLIENT, row: BASE_ROW }),
  ]);

  const fulfilled = results.filter((item) => item.status === 'fulfilled');
  const rejected = results.filter((item) => item.status === 'rejected');

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof CampDuplicateError);

  const camps = await CampOpsCamp.find({ isDeleted: false });
  assert.equal(camps.length, 1);
});

test('different doctor or start time is not a duplicate', async () => {
  await resetCamps([seedCamp({ campId: '26-09-base' })]);

  const otherDoctor = await findExistingDuplicateCamp({
    client: CLIENT,
    row: { ...BASE_ROW, doctorName: 'Dr. Anita Desai' },
  });
  const otherTime = await findExistingDuplicateCamp({
    client: CLIENT,
    row: { ...BASE_ROW, startTime: '14:00' },
  });

  assert.equal(otherDoctor, null);
  assert.equal(otherTime, null);
});

test('duplicate detection requires exact doctor, campaign, and start time values', async () => {
  await resetCamps([seedCamp({ campId: '26-09-exact' })]);

  const changedDoctorFormat = await findExistingDuplicateCamp({
    client: CLIENT,
    row: { ...BASE_ROW, doctorName: 'rajesh kumar' },
  });
  const changedCampaignCase = await findExistingDuplicateCamp({
    client: CLIENT,
    row: { ...BASE_ROW, campaignType: 'screening' },
  });
  const changedTimeFormat = await findExistingDuplicateCamp({
    client: CLIENT,
    row: { ...BASE_ROW, startTime: '9:00 AM' },
  });

  assert.equal(changedDoctorFormat, null);
  assert.equal(changedCampaignCase, null);
  assert.equal(changedTimeFormat, null);
});

test('form flow allows create when any one duplicate field changes', async () => {
  await resetCamps([seedCamp({ campId: '26-09-form-base' })]);

  const variants = [
    { label: 'client', client: { _id: 'client-2', name: 'Other Pharma' }, row: { ...BASE_ROW, clientName: 'Other Pharma' } },
    { label: 'doctor', client: CLIENT, row: { ...BASE_ROW, doctorName: 'Dr. Anita Desai' } },
    { label: 'campaign', client: CLIENT, row: { ...BASE_ROW, campaignType: 'Cardio' } },
    { label: 'date', client: CLIENT, row: { ...BASE_ROW, campDate: '2026-09-16' } },
    { label: 'time', client: CLIENT, row: { ...BASE_ROW, startTime: '14:00' } },
  ];

  for (const [index, variant] of variants.entries()) {
    const created = await createCampEnsuringNoDuplicate(
      CampOpsCamp,
      {
        campId: `26-09-form-${index}`,
        clientId: variant.client._id,
        clientName: variant.client.name,
        doctorName: variant.row.doctorName,
        campaignType: variant.row.campaignType,
        campDate: variant.row.campDate,
        startTime: variant.row.startTime,
        endTime: '12:00',
        lifecycleStage: 'request',
        status: 'pending_review',
        source: 'dashboard',
      },
      { client: variant.client, row: variant.row },
    );
    assert.equal(created.campId, `26-09-form-${index}`, `expected ${variant.label} change to allow create`);
  }
});

test('excel import flow allows create when any one duplicate field changes', async () => {
  await resetCamps([seedCamp({ campId: '26-09-excel-base' })]);

  const variants = [
    { label: 'client', client: { _id: 'client-2', name: 'Other Pharma' }, row: { ...BASE_ROW, clientName: 'Other Pharma' } },
    { label: 'doctor', client: CLIENT, row: { ...BASE_ROW, doctorName: 'Dr. Anita Desai' } },
    { label: 'campaign', client: CLIENT, row: { ...BASE_ROW, campaignType: 'Cardio' } },
    { label: 'date', client: CLIENT, row: { ...BASE_ROW, campDate: '2026-09-16' } },
    { label: 'time', client: CLIENT, row: { ...BASE_ROW, startTime: '14:00' } },
  ];

  for (const [index, variant] of variants.entries()) {
    const duplicate = await findExistingDuplicateCamp({ client: variant.client, row: variant.row });
    assert.equal(duplicate, null, `expected ${variant.label} change to avoid import duplicate`);

    const created = await createCampEnsuringNoDuplicate(
      CampOpsCamp,
      {
        campId: `26-09-excel-${index}`,
        clientId: variant.client._id,
        clientName: variant.client.name,
        doctorName: variant.row.doctorName,
        campaignType: variant.row.campaignType,
        campDate: variant.row.campDate,
        startTime: variant.row.startTime,
        endTime: '12:00',
        lifecycleStage: 'request',
        status: 'pending_review',
        source: 'excel',
      },
      { client: variant.client, row: variant.row },
    );
    assert.equal(created.campId, `26-09-excel-${index}`);
  }
});

test('manual paste flow duplicate semantics allow create when any one duplicate field changes', async () => {
  await resetCamps([seedCamp({ campId: '26-09-paste-base' })]);

  const variants = [
    { label: 'client', client: { _id: 'client-2', name: 'Other Pharma' }, row: { ...BASE_ROW, clientName: 'Other Pharma' } },
    { label: 'doctor', client: CLIENT, row: { ...BASE_ROW, doctorName: 'Rajesh Kumar' } },
    { label: 'campaign', client: CLIENT, row: { ...BASE_ROW, campaignType: 'Cardio' } },
    { label: 'date', client: CLIENT, row: { ...BASE_ROW, campDate: '2026-09-16' } },
    { label: 'time', client: CLIENT, row: { ...BASE_ROW, startTime: '14:00' } },
  ];

  for (const [index, variant] of variants.entries()) {
    const duplicate = await findExistingDuplicateCamp({ client: variant.client, row: variant.row });
    assert.equal(duplicate, null, `expected ${variant.label} change to avoid paste duplicate`);

    const created = await createCampEnsuringNoDuplicate(
      CampOpsCamp,
      {
        campId: `26-09-paste-${index}`,
        clientId: variant.client._id,
        clientName: variant.client.name,
        doctorName: variant.row.doctorName,
        campaignName: variant.row.campaignName,
        campaignType: variant.row.campaignType,
        campDate: variant.row.campDate,
        startTime: variant.row.startTime,
        endTime: '12:00',
        lifecycleStage: 'request',
        status: 'pending_review',
        source: 'paste',
      },
      { client: variant.client, row: variant.row },
    );
    assert.equal(created.campId, `26-09-paste-${index}`, `expected ${variant.label} change to allow paste create`);
  }
});

test('soft-deleted camps do not block duplicates', async () => {
  await resetCamps([seedCamp({ campId: '26-09-deleted', isDeleted: true })]);

  const duplicate = await findExistingDuplicateCamp({ client: CLIENT, row: BASE_ROW });
  assert.equal(duplicate, null);

  const created = await createCampEnsuringNoDuplicate(
    CampOpsCamp,
    {
      campId: '26-09-replace',
      clientId: CLIENT._id,
      clientName: CLIENT.name,
      ...BASE_ROW,
      endTime: '12:00',
      lifecycleStage: 'request',
      status: 'pending_review',
      source: 'dashboard',
    },
    { client: CLIENT, row: BASE_ROW },
  );
  assert.ok(created.campId);
});
