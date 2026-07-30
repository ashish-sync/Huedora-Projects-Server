/**
 * Camp One end-to-end workflow test (operator scenarios).
 * Requires API running: npm run dev:server
 *
 * Usage:
 *   node scripts/camp-one-e2e-test.js
 *   API_BASE=http://localhost:5000/api/v1 node scripts/camp-one-e2e-test.js
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import { ensureSeed } from '../src/seed.js';
import { ensureCampOpsSeed, CAMP_ONE_DEMO } from '../src/modules/campOps/campOps.seed.js';

const base = (process.env.API_BASE || 'http://localhost:5000/api/v1').replace(/\/$/, '');

const results = [];
let token = '';

function pass(name) {
  results.push({ name, ok: true });
  console.log(`  ✓ ${name}`);
}

function fail(name, error) {
  const message = error?.message || String(error);
  results.push({ name, ok: false, message });
  console.error(`  ✗ ${name}: ${message}`);
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const message = json?.error?.message || json?.message || `HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.json = json;
    throw err;
  }

  return json;
}

function campPayload(overrides = {}) {
  const campDate = overrides.campDate || '2026-09-01';
  return {
    clientName: CAMP_ONE_DEMO.clientName,
    campaignType: CAMP_ONE_DEMO.division,
    campaignName: CAMP_ONE_DEMO.method,
    source: 'dashboard',
    campDate,
    requestDate: '2026-07-25',
    startTime: '10:00',
    endTime: '13:00',
    doctorName: 'Dr. E2E Test',
    doctorCode: `E2E-${Date.now()}`,
    campAddress: '45 FC Road, Pune, Maharashtra 411004',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411004',
    hq: 'Pune',
    zone: 'West Zone',
    expectedPatients: 40,
    fieldPersonName: 'Test Contact',
    fieldPersonPhone: '9988776655',
    lifecycleStage: 'request',
    ...overrides,
  };
}

async function runStep(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

async function main() {
  console.log('\nCamp One E2E — seeding database…');
  await connectDb();
  await ensureSeed();
  const seed = await ensureCampOpsSeed();
  await disconnectDb();
  console.log(`  Demo admin: ${CAMP_ONE_DEMO.adminEmail}`);
  console.log(`  Demo camps: ${seed.camps.length} (${seed.createdCamps} newly created)\n`);

  console.log('Camp One E2E — API workflow tests\n');

  await runStep('Login as demo camp admin', async () => {
    const login = await api('/auth/login', {
      method: 'POST',
      auth: false,
      body: { email: CAMP_ONE_DEMO.adminEmail, password: CAMP_ONE_DEMO.adminPassword },
    });
    token = login.data?.accessToken || login.accessToken;
    if (!token) throw new Error('No access token returned');
  });

  let createdCampId = '';
  let createdCampMongoId = '';
  let assignmentCampId = '';
  let hcwContactId = '';

  await runStep('Dashboard stats load', async () => {
    const stats = await api('/camp-ops/dashboard/stats');
    if (!stats?.camps?.total && stats?.camps?.total !== 0) throw new Error('Missing dashboard stats');
  });

  await runStep('List camps (request stage filter)', async () => {
    const list = await api('/camp-ops/camps?lifecycleStage=request&limit=20');
    const rows = list.data?.data || list.data || [];
    if (!Array.isArray(rows)) throw new Error('Expected camp list array');
  });

  await runStep('Create camp — request stage', async () => {
    const res = await api('/camp-ops/camps', {
      method: 'POST',
      body: campPayload(),
    });
    const camp = res.data;
    if (!camp?._id) throw new Error('Camp not created');
    createdCampMongoId = camp._id;
    createdCampId = camp.campId;
    if (camp.status !== 'pending_review') throw new Error(`Expected pending_review, got ${camp.status}`);
  });

  await runStep('Get camp detail', async () => {
    const res = await api(`/camp-ops/camps/${createdCampMongoId}`);
    if (!res.data?.campId) throw new Error('Camp detail missing');
  });

  await runStep('Request more information', async () => {
    await api(`/camp-ops/camps/${createdCampMongoId}/request-information`, {
      method: 'POST',
      body: { informationRequestNote: 'E2E test — please update doctor phone.' },
    });
    const res = await api(`/camp-ops/camps/${createdCampMongoId}`);
    if (res.data.requestReviewStatus !== 'information_requested') {
      throw new Error(`Expected information_requested, got ${res.data.requestReviewStatus}`);
    }
  });

  await runStep('Update camp after information request', async () => {
    await api(`/camp-ops/camps/${createdCampMongoId}`, {
      method: 'PUT',
      body: {
        ...campPayload({ doctorCode: `E2E-UPD-${Date.now()}` }),
        fieldPersonPhone: '9876512345',
        editingStage: 'request',
        lifecycleOnly: false,
      },
    });
  });

  await runStep('Approve camp', async () => {
    await api(`/camp-ops/camps/${createdCampMongoId}/approve`, { method: 'POST' });
    const res = await api(`/camp-ops/camps/${createdCampMongoId}`);
    if (res.data.status !== 'approved') throw new Error(`Expected approved, got ${res.data.status}`);
  });

  await runStep('List HCW contacts', async () => {
    const res = await api('/contacts?limit=50');
    const contacts = res.data || [];
    const hcw = contacts.find((c) => c.name === CAMP_ONE_DEMO.hcwName);
    if (!hcw) throw new Error('Demo HCW contact not found');
    hcwContactId = hcw._id;
  });

  await runStep('Assign HCW — assignment stage', async () => {
    await api(`/camp-ops/camps/${createdCampMongoId}`, {
      method: 'PUT',
      body: {
        editingStage: 'assignment',
        lifecycleStage: 'execution',
        lifecycleOnly: true,
        assignmentDecision: 'assign',
        hcwContactId,
        hcwCategory: 'Technician',
        hcwName: CAMP_ONE_DEMO.hcwName,
        hcwContact: '9123456780',
      },
    });
    const res = await api(`/camp-ops/camps/${createdCampMongoId}`);
    if (res.data.assignmentDecision !== 'assign') throw new Error('Assignment not saved');
    if (res.data.lifecycleStage !== 'execution') throw new Error('Should advance to execution');
  });

  await runStep('Update execution stage fields', async () => {
    await api(`/camp-ops/camps/${createdCampMongoId}`, {
      method: 'PUT',
      body: {
        editingStage: 'execution',
        lifecycleStage: 'execution',
        lifecycleOnly: true,
        executionStatus: 'Ongoing',
        inTime: '09:55',
        outTime: '13:10',
        patientsCount: 38,
        chargeableStatus: 'Chargeable',
        attire: 'No Issues',
        labCoat: 'No Issues',
      },
    });
  });

  await runStep('Mark camp executed', async () => {
    await api(`/camp-ops/camps/${createdCampMongoId}/execute`, {
      method: 'POST',
      body: { actualPatients: 38 },
    });
    const res = await api(`/camp-ops/camps/${createdCampMongoId}`);
    if (res.data.status !== 'executed') throw new Error(`Expected executed, got ${res.data.status}`);
  });

  await runStep('Update financial stage', async () => {
    await api(`/camp-ops/camps/${createdCampMongoId}`, {
      method: 'PUT',
      body: {
        editingStage: 'financial',
        lifecycleStage: 'financial',
        maxLifecycleStage: 'financial',
        lifecycleOnly: true,
        campAmount: 15000,
        travelling: 500,
        campRevenue: 20000,
        paidAmount: 10000,
      },
    });
  });

  await runStep('Create camp for refusal flow', async () => {
    const res = await api('/camp-ops/camps', {
      method: 'POST',
      body: campPayload({ doctorCode: `REF-${Date.now()}`, campDate: '2026-09-10' }),
    });
    assignmentCampId = res.data._id;
    await api(`/camp-ops/camps/${assignmentCampId}/approve`, { method: 'POST' });
  });

  await runStep('Close camp — Refused (duplicate request)', async () => {
    await api(`/camp-ops/camps/${assignmentCampId}/close`, {
      method: 'POST',
      body: {
        closureType: 'Refused',
        reasonCategory: 'Request Issue',
        subReason: 'duplicate_request',
      },
    });
    const res = await api(`/camp-ops/camps/${assignmentCampId}`);
    if (res.data.status !== 'rejected') throw new Error(`Expected rejected, got ${res.data.status}`);
    if (res.data.closureReasonCode !== 'duplicate_request') throw new Error('Closure sub-reason not saved');
  });

  await runStep('Create camp for TCPL cancellation', async () => {
    const res = await api('/camp-ops/camps', {
      method: 'POST',
      body: campPayload({ doctorCode: `TCPL-${Date.now()}`, campDate: '2026-09-12' }),
    });
    const id = res.data._id;
    await api(`/camp-ops/camps/${id}/approve`, { method: 'POST' });
    await api(`/camp-ops/camps/${id}/close`, {
      method: 'POST',
      body: {
        closureType: 'Cancelled by TCPL',
        reasonCategory: 'Device & Inventory',
        subReason: 'device_failure',
      },
    });
    const closed = await api(`/camp-ops/camps/${id}`);
    if (closed.data.status !== 'cancelled') throw new Error('Expected cancelled');
  });

  await runStep('Manual paste extract preview', async () => {
    const text = `
Date: 20/08/2026
Doctor Name: Dr. Paste Demo
Doctor Code: PASTE01
Camp Address: 1 Demo Street, Pune, Maharashtra 411001
Expected Patients: 30
SE Name: SE Demo
SE Mobile: 9000000001
09:00
12:00
`.trim();
    const res = await api('/camp-ops/communications/paste/extract', {
      method: 'POST',
      body: {
        text,
        clientName: CAMP_ONE_DEMO.clientName,
        campaignType: CAMP_ONE_DEMO.division,
        campaignName: CAMP_ONE_DEMO.method,
      },
    });
    const preview = res.data?.bodyPreview || [];
    if (!preview.length || !preview[0].pasteDisplay) throw new Error('Paste preview missing display fields');
  });

  await runStep('Geo zones resolve for Maharashtra', async () => {
    const res = await api('/geo/zones/resolve?stateName=Maharashtra');
    if (!res.data?.zone) throw new Error('Zone not resolved');
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'─'.repeat(48)}`);
  console.log(`Results: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('\nFailed steps:');
    for (const item of failed) console.log(`  • ${item.name}: ${item.message}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll Camp One workflow scenarios passed.');
    console.log(`\nDemo login: ${CAMP_ONE_DEMO.adminEmail} / ${CAMP_ONE_DEMO.adminPassword}`);
    console.log('UI: http://localhost:5173/camps/manage');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
