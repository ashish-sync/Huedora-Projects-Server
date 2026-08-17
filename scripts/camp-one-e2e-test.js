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
let stamp = '';
let assignSlot = 0;
let createSlot = 0;
let hcwContactId = '';

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

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function campPayload(overrides = {}) {
  const today = isoToday();
  createSlot += 1;
  const uniq = `${stamp}-${createSlot}-${Date.now().toString(36).slice(-5)}`;
  const dayOffset = (createSlot % 25) + 1;
  const hour = 6 + (createSlot % 8);
  const minute = (createSlot * 11) % 60;
  const startTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const endTime = `${String(Math.min(hour + 3, 23)).padStart(2, '0')}:00`;
  const label = overrides.doctorName || 'E2E Test Doctor';
  return {
    clientName: CAMP_ONE_DEMO.clientName,
    campaignType: CAMP_ONE_DEMO.campaignType,
    campaignName: CAMP_ONE_DEMO.method,
    source: 'dashboard',
    campDate: addDaysIso(today, dayOffset),
    requestDate: today,
    startTime,
    endTime,
    doctorName: `${label} ${uniq}`,
    doctorCode: (overrides.doctorCode || `E2E-${uniq}`).slice(0, 28),
    campAddress: '45 FC Road, Pune, Maharashtra 411004',
    city: 'Pune',
    district: 'Pune',
    state: 'Maharashtra',
    pincode: '411004',
    hq: 'Pune',
    zone: 'West Zone',
    expectedPatients: 40,
    fieldPersonName: 'Test Contact',
    fieldPersonPhone: '9988776655',
    contactPersons: [
      { level: 'Territory Manager', name: 'Test Contact', phone: '9988776655' },
    ],
    lifecycleStage: 'request',
    ...overrides,
    doctorName: `${label} ${uniq}`,
    doctorCode: (overrides.doctorCode || `E2E-${uniq}`).slice(0, 28),
    campDate: overrides.campDate || addDaysIso(today, dayOffset),
    startTime: overrides.startTime || startTime,
    endTime: overrides.endTime || endTime,
    campaignType: overrides.campaignType || CAMP_ONE_DEMO.campaignType,
  };
}

async function getCamp(id) {
  const res = await api(`/camp-ops/camps/${id}`);
  if (!res.data?._id) throw new Error('Camp detail missing');
  return res.data;
}

function nextAssignWindow() {
  const hour = 6 + (assignSlot % 10);
  assignSlot += 1;
  const start = `${String(hour).padStart(2, '0')}:00`;
  const endHour = Math.min(hour + 3, 23);
  const end = `${String(endHour).padStart(2, '0')}:00`;
  return {
    start,
    end,
    campDate: addDaysIso(isoToday(), 30 + assignSlot),
    inTime: `${String(hour).padStart(2, '0')}:05`,
    outTime: `${String(Math.max(hour + 1, endHour - 1)).padStart(2, '0')}:50`,
  };
}

async function assignHcw(campId) {
  const window = nextAssignWindow();
  await api(`/camp-ops/camps/${campId}`, {
    method: 'PUT',
    body: {
      editingStage: 'assignment',
      lifecycleStage: 'assignment',
      lifecycleOnly: false,
      assignmentDecision: 'assign',
      hcwContactId,
      hcwCategory: 'Technician',
      hcwName: CAMP_ONE_DEMO.hcwName,
      hcwContact: '9123456780',
      campDate: window.campDate,
      startTime: window.start,
      endTime: window.end,
      hcwGapOverrideAcknowledged: true,
    },
  });
  return getCamp(campId);
}

async function fillExecutionPlannedToExecuted(campId) {
  const current = await getCamp(campId);
  await api(`/camp-ops/camps/${campId}`, {
    method: 'PUT',
    body: {
      editingStage: 'execution',
      lifecycleStage: 'execution',
      lifecycleOnly: false,
      campDate: current.campDate,
      startTime: current.startTime,
      endTime: current.endTime,
      chargeableStatus: 'Chargeable',
      inTime: `${String(current.startTime || '06:00').slice(0, 2)}:05`,
      attire: 'No Issues',
      labCoat: 'No Issues',
      hcwGapOverrideAcknowledged: true,
    },
  });
  return getCamp(campId);
}

async function fillExecutionReady(campId) {
  const current = await getCamp(campId);
  const start = current.startTime || '06:00';
  const end = current.endTime || '12:00';
  const inTime = `${start.slice(0, 2)}:05`;
  const outHour = Math.max(0, Number(end.slice(0, 2)) - 1);
  const outTime = `${String(outHour).padStart(2, '0')}:50`;
  await api(`/camp-ops/camps/${campId}`, {
    method: 'PUT',
    body: {
      editingStage: 'execution',
      lifecycleStage: 'execution',
      lifecycleOnly: false,
      campDate: current.campDate || isoToday(),
      startTime: start,
      endTime: end,
      chargeableStatus: 'Chargeable',
      inTime,
      attire: 'No Issues',
      labCoat: 'No Issues',
      outTime,
      kmRoundTrip: 42,
      patientsCount: 38,
      actualPatients: 38,
      rxCount: 10,
      hcwGapOverrideAcknowledged: true,
      executionDocuments: [
        { docType: 'doctor_form', fileName: 'df-e2e.pdf', url: 'https://example.local/df-e2e.pdf' },
        { docType: 'patient_form', fileName: 'pf-e2e.pdf', url: 'https://example.local/pf-e2e.pdf' },
      ],
    },
  });
  return getCamp(campId);
}

async function markComplete(campId) {
  const current = await getCamp(campId);
  if (current.lifecycleStage === 'financial' && current.executionStatus === 'Camp Completed') {
    return current;
  }
  await api(`/camp-ops/camps/${campId}`, {
    method: 'PUT',
    body: {
      editingStage: 'execution',
      lifecycleStage: 'execution',
      markComplete: true,
      lifecycleOnly: false,
      chargeableStatus: current.chargeableStatus || 'Chargeable',
      inTime: current.inTime || '06:05',
      attire: current.attire || 'No Issues',
      outTime: current.outTime || '11:50',
      kmRoundTrip: current.kmRoundTrip ?? 42,
      patientsCount: current.patientsCount ?? 38,
      actualPatients: current.actualPatients ?? 38,
      rxCount: current.rxCount ?? 10,
      hcwGapOverrideAcknowledged: true,
      executionDocuments: current.executionDocuments?.length
        ? current.executionDocuments
        : [
          { docType: 'doctor_form', fileName: 'df-e2e.pdf', url: 'https://example.local/df-e2e.pdf' },
          { docType: 'patient_form', fileName: 'pf-e2e.pdf', url: 'https://example.local/pf-e2e.pdf' },
        ],
    },
  });
  return getCamp(campId);
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
  stamp = Date.now().toString(36).slice(-6);
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
    const before = await getCamp(createdCampMongoId);
    await api(`/camp-ops/camps/${createdCampMongoId}`, {
      method: 'PUT',
      body: {
        editingStage: 'request',
        lifecycleOnly: false,
        fieldPersonPhone: '9876512345',
        doctorName: before.doctorName,
        doctorCode: before.doctorCode,
        campAddress: before.campAddress,
        city: before.city,
        district: before.district,
        state: before.state,
        pincode: before.pincode,
        hq: before.hq,
        zone: before.zone,
        expectedPatients: before.expectedPatients,
        startTime: before.startTime,
        endTime: before.endTime,
        campDate: before.campDate,
        requestDate: before.requestDate || isoToday(),
        campaignType: before.campaignType,
        campaignName: before.campaignName,
        clientName: before.clientName,
        contactPersons: before.contactPersons,
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

  await runStep('Assign HCW — immediate promotion to Execution', async () => {
    const camp = await assignHcw(createdCampMongoId);
    if (camp.assignmentDecision !== 'assign') throw new Error('Assignment not saved');
    if (camp.lifecycleStage !== 'execution') {
      throw new Error(`Expected execution immediately after assign, got ${camp.lifecycleStage}`);
    }
    if (String(camp.hcwContactId) !== String(hcwContactId)) {
      throw new Error('HCW contact id not linked on camp');
    }
  });

  await runStep('Planned → Executed then Mark Complete', async () => {
    let camp = await fillExecutionPlannedToExecuted(createdCampMongoId);
    if (camp.executionStatus !== 'Marked Executed') {
      throw new Error(`Expected Marked Executed, got ${camp.executionStatus}`);
    }
    camp = await fillExecutionReady(createdCampMongoId);
    if (camp.lifecycleStage !== 'financial') {
      camp = await markComplete(createdCampMongoId);
    }
    if (camp.lifecycleStage !== 'financial') {
      throw new Error(`Expected financial after Mark Complete, got ${camp.lifecycleStage}`);
    }
    if (camp.status !== 'executed') throw new Error(`Expected executed, got ${camp.status}`);
  });

  await runStep('Confirm payment and submit to Finance One', async () => {
    await api(`/camp-ops/camps/${createdCampMongoId}/confirm-payment`, { method: 'POST' });
    let camp = await getCamp(createdCampMongoId);
    if (camp.paymentSubmitStatus !== 'payment_confirmed') {
      throw new Error(`Expected payment_confirmed, got ${camp.paymentSubmitStatus}`);
    }

    await api(`/camp-ops/camps/${createdCampMongoId}/submit-to-finance`, {
      method: 'POST',
      body: { paymentSubmitStatus: 'payment_confirmed' },
    });
    camp = await getCamp(createdCampMongoId);
    if (camp.financePaymentStatus !== 'under_review') {
      throw new Error(`Expected under_review, got ${camp.financePaymentStatus}`);
    }
    if (!camp.submittedToFinanceAt) throw new Error('submittedToFinanceAt missing');
  });

  await runStep('Finance payouts list includes submitted camp', async () => {
    const res = await api('/finance/camp-payouts?limit=50');
    const rows = Array.isArray(res.data) ? res.data : (res.data?.data || []);
    const found = rows.find(
      (row) => String(row._id) === String(createdCampMongoId) || String(row.campId) === String(createdCampId)
    );
    if (!found) throw new Error('Submitted camp not visible in finance camp payouts');
  });

  await runStep('Reject execute without HCW assignment', async () => {
    const res = await api('/camp-ops/camps', {
      method: 'POST',
      body: campPayload({ doctorName: 'No HCW Doctor' }),
    });
    const id = res.data._id;
    await api(`/camp-ops/camps/${id}/approve`, { method: 'POST' });
    let blocked = false;
    try {
      await api(`/camp-ops/camps/${id}/execute`, { method: 'POST', body: { actualPatients: 1 } });
    } catch (err) {
      blocked = /healthcare worker/i.test(err.message);
    }
    if (!blocked) throw new Error('Execute should require HCW assignment');
  });

  await runStep('Create Client Master program with billing', async () => {
    const res = await api('/camp-ops/client-masters', {
      method: 'POST',
      body: {
        clientName: CAMP_ONE_DEMO.clientName,
        clientCode: CAMP_ONE_DEMO.clientCode,
        programName: `E2E Billing ${Date.now()}`,
        campName: CAMP_ONE_DEMO.method,
        campType: 'HCW + Device',
        coordinatorName: 'E2E Coord',
        healthcareWorker: 'Technician',
        spocName: 'E2E Spoc',
        spocNumber: '9876543210',
        spocEmail: 'e2e.spoc@demo.tylo.local',
        billing: {
          address: '216 Corporate Avenue, Mumbai',
          gstin: '27AADCK4268L1Z4',
          pan: 'AADCK4268L',
          stateName: 'Maharashtra',
          stateCode: '27',
          contactPerson: 'Billing Desk',
          email: 'billing@demo.tylo.local',
          phone: '02261131400',
        },
      },
    });
    if (!res.data?._id) throw new Error('Client master not created');
    const detail = await api(`/camp-ops/client-masters/${res.data._id}`);
    if (!detail.data?.billing?.gstin) throw new Error('Client billing GSTIN not persisted');
  });

  await runStep('Create camp for refusal flow', async () => {
    const res = await api('/camp-ops/camps', {
      method: 'POST',
      body: campPayload({ doctorName: 'Refusal Flow Doctor' }),
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

  await runStep('Create camp for Tylo cancellation (Execution stage)', async () => {
    const res = await api('/camp-ops/camps', {
      method: 'POST',
      body: campPayload({ doctorName: 'Tylo Cancel Doctor' }),
    });
    const id = res.data._id;
    await api(`/camp-ops/camps/${id}/approve`, { method: 'POST' });
    await assignHcw(id);
    await api(`/camp-ops/camps/${id}/close`, {
      method: 'POST',
      body: {
        closureType: 'Cancelled by Tylo',
        reasonCategory: 'Device & Inventory',
        subReason: 'device_failure',
        chargeableStatus: 'Non-Chargeable',
      },
    });
    const closed = await api(`/camp-ops/camps/${id}`);
    if (closed.data.status !== 'cancelled') throw new Error('Expected cancelled');
    if (closed.data.lifecycleStage !== 'financial') {
      throw new Error(`Expected financial after Tylo cancel, got ${closed.data.lifecycleStage}`);
    }
  });

  await runStep('Manual paste extract preview', async () => {
    const pasteDate = addDaysIso(isoToday(), 40);
    const text = `
Date: ${pasteDate.split('-').reverse().join('/')}
Doctor Name: Paste Demo
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
        campaignType: CAMP_ONE_DEMO.campaignType,
        campaignName: CAMP_ONE_DEMO.method,
      },
    });
    const preview = res.data?.bodyPreview || [];
    if (!preview.length || !preview[0].pasteDisplay) throw new Error('Paste preview missing display fields');
    const row = preview[0].row || {};
    if (!row.campDate) throw new Error('Paste extract lost campDate (newlines may be collapsed)');
    if (!row.doctorName) throw new Error('Paste extract lost doctorName');
    if (!row.doctorCode) throw new Error('Paste extract lost doctorCode');
    if (preview[0].valid === false) {
      throw new Error(`Paste row failed Client Master validation: ${(preview[0].errors || []).join('; ')}`);
    }
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
