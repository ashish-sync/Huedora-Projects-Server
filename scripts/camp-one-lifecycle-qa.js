/**
 * Production-grade Camp One QA:
 * Creates 4 camps via distinct methods, runs full lifecycle through Finance One,
 * verifies status transitions, payments, and audit trails.
 *
 * Requires API: npm run dev:server
 *   node scripts/camp-one-lifecycle-qa.js
 *   API_BASE=http://localhost:5000/api/v1 node scripts/camp-one-lifecycle-qa.js
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import { ensureSeed } from '../src/seed.js';
import { ensureCampOpsSeed, CAMP_ONE_DEMO } from '../src/modules/campOps/campOps.seed.js';

const base = (process.env.API_BASE || 'http://localhost:5000/api/v1').replace(/\/$/, '');
const results = [];
let token = '';
let hcwContactId = '';
let stamp = '';
let assignSlot = 0;
let createSlot = 0;

function pass(name) {
  results.push({ name, ok: true });
  console.log(`  ✓ ${name}`);
}

function fail(name, error) {
  const message = error?.message || String(error);
  results.push({ name, ok: false, message });
  console.error(`  ✗ ${name}: ${message}`);
}

async function runStep(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
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

function formatDdMmYyyy(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function assertStatus(camp, expected) {
  if (camp.status !== expected) {
    throw new Error(`Expected status ${expected}, got ${camp.status}`);
  }
}

function assertStage(camp, expected) {
  if (camp.lifecycleStage !== expected) {
    throw new Error(`Expected lifecycleStage ${expected}, got ${camp.lifecycleStage}`);
  }
}

function nextCreateSlot() {
  createSlot += 1;
  const uniq = `${stamp}-${createSlot}-${Date.now().toString(36).slice(-5)}`;
  const dayOffset = 30 + createSlot * 2;
  const hour = 6 + (createSlot % 8);
  const minute = (createSlot * 13) % 60;
  const startTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const endTime = `${String(Math.min(hour + 3, 23)).padStart(2, '0')}:00`;
  return { uniq, dayOffset, startTime, endTime, campDate: addDaysIso(isoToday(), dayOffset) };
}

async function getCamp(id) {
  const res = await api(`/camp-ops/camps/${id}`);
  if (!res.data?._id) throw new Error('Camp detail missing');
  return res.data;
}

async function findAudits(entityId, actionIncludes = '') {
  const res = await api(
    `/audit-logs?entityType=camp_ops_camp&entityId=${encodeURIComponent(entityId)}&limit=100`,
  );
  const rows = Array.isArray(res.data) ? res.data : (res.data?.data || []);
  if (!actionIncludes) return rows;
  return rows.filter((row) => String(row.action || '').includes(actionIncludes));
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
    campDate: addDaysIso(isoToday(), 100 + assignSlot * 7),
    inTime: `${String(hour).padStart(2, '0')}:05`,
    outTime: `${String(Math.max(hour + 1, endHour - 1)).padStart(2, '0')}:50`,
  };
}

async function assignHcw(campMongoId) {
  const window = nextAssignWindow();
  await api(`/camp-ops/camps/${campMongoId}`, {
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
  return getCamp(campMongoId);
}

async function fillExecutionPlannedToExecuted(campMongoId) {
  const current = await getCamp(campMongoId);
  await api(`/camp-ops/camps/${campMongoId}`, {
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
  return getCamp(campMongoId);
}

async function fillExecutionReady(campMongoId) {
  const current = await getCamp(campMongoId);
  const start = current.startTime || '06:00';
  const end = current.endTime || '12:00';
  const inTime = `${start.slice(0, 2)}:05`;
  const outHour = Math.max(0, Number(end.slice(0, 2)) - 1);
  const outTime = `${String(outHour).padStart(2, '0')}:50`;
  await api(`/camp-ops/camps/${campMongoId}`, {
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
      patientsCount: 36,
      actualPatients: 36,
      rxCount: 10,
      hcwGapOverrideAcknowledged: true,
      executionDocuments: [
        { docType: 'doctor_form', fileName: 'df-qa.pdf', url: 'https://example.local/df-qa.pdf' },
        { docType: 'patient_form', fileName: 'pf-qa.pdf', url: 'https://example.local/pf-qa.pdf' },
      ],
    },
  });
  return getCamp(campMongoId);
}

async function markComplete(campMongoId) {
  const current = await getCamp(campMongoId);
  if (current.lifecycleStage === 'financial' && current.executionStatus === 'Camp Completed') {
    return current;
  }
  await api(`/camp-ops/camps/${campMongoId}`, {
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
      patientsCount: current.patientsCount ?? 36,
      actualPatients: current.actualPatients ?? 36,
      rxCount: current.rxCount ?? 10,
      hcwGapOverrideAcknowledged: true,
      executionDocuments: current.executionDocuments?.length
        ? current.executionDocuments
        : [
          { docType: 'doctor_form', fileName: 'df-qa.pdf', url: 'https://example.local/df-qa.pdf' },
          { docType: 'patient_form', fileName: 'pf-qa.pdf', url: 'https://example.local/pf-qa.pdf' },
        ],
    },
  });
  return getCamp(campMongoId);
}

async function processLifecycle(label, campMongoId, { markPaid = true } = {}) {
  await runStep(`${label}: approve`, async () => {
    await api(`/camp-ops/camps/${campMongoId}/approve`, { method: 'POST' });
    const camp = await getCamp(campMongoId);
    assertStatus(camp, 'approved');
    assertStage(camp, 'assignment');
  });

  await runStep(`${label}: assign HCW → Execution immediately`, async () => {
    const camp = await assignHcw(campMongoId);
    if (camp.assignmentDecision !== 'assign') throw new Error('Assignment not saved');
    assertStage(camp, 'execution');
  });

  await runStep(`${label}: Planned → Executed`, async () => {
    const camp = await fillExecutionPlannedToExecuted(campMongoId);
    assertStage(camp, 'execution');
    if (camp.executionStatus !== 'Marked Executed') {
      throw new Error(`Expected Marked Executed, got ${camp.executionStatus}`);
    }
  });

  await runStep(`${label}: Mark Complete → Financial`, async () => {
    let camp = await fillExecutionReady(campMongoId);
    if (camp.lifecycleStage !== 'financial') {
      camp = await markComplete(campMongoId);
    }
    assertStatus(camp, 'executed');
    assertStage(camp, 'financial');
  });

  await runStep(`${label}: financial amounts`, async () => {
    await api(`/camp-ops/camps/${campMongoId}`, {
      method: 'PUT',
      body: {
        editingStage: 'financial',
        lifecycleStage: 'financial',
        maxLifecycleStage: 'financial',
        lifecycleOnly: true,
        campAmount: 15000,
        travelling: 500,
        campRevenue: 20000,
        hcwGapOverrideAcknowledged: true,
      },
    });
    const camp = await getCamp(campMongoId);
    if (Number(camp.totalPayout) !== 15500) {
      throw new Error(`Expected totalPayout 15500, got ${camp.totalPayout}`);
    }
  });

  await runStep(`${label}: Confirm Payment`, async () => {
    await api(`/camp-ops/camps/${campMongoId}/confirm-payment`, { method: 'POST' });
    const camp = await getCamp(campMongoId);
    if (camp.paymentSubmitStatus !== 'payment_confirmed') {
      throw new Error(`Expected payment_confirmed, got ${camp.paymentSubmitStatus}`);
    }
  });

  await runStep(`${label}: submit to Finance One`, async () => {
    await api(`/camp-ops/camps/${campMongoId}/submit-to-finance`, {
      method: 'POST',
      body: { paymentSubmitStatus: 'payment_confirmed' },
    });
    const camp = await getCamp(campMongoId);
    if (camp.financePaymentStatus !== 'under_review') {
      throw new Error(`Expected under_review, got ${camp.financePaymentStatus}`);
    }
    if (!camp.submittedToFinanceAt) throw new Error('submittedToFinanceAt missing');
  });

  await runStep(`${label}: visible in finance payouts`, async () => {
    const res = await api('/finance/camp-payouts?limit=100');
    const rows = Array.isArray(res.data) ? res.data : [];
    const found = rows.find((row) => String(row._id) === String(campMongoId));
    if (!found) throw new Error('Camp not in finance camp-payouts');
  });

  if (markPaid) {
    await runStep(`${label}: Finance marks paid`, async () => {
      await api(`/finance/camp-payouts/${campMongoId}`, {
        method: 'PATCH',
        body: {
          financePaymentStatus: 'paid',
          paidAmount: 15500,
          transactionId: `UTR-QA-${label}-${stamp}`,
          paymentDate: isoToday(),
          paymentRemark: `${label} payout settled`,
        },
      });
      const camp = await getCamp(campMongoId);
      if (camp.financePaymentStatus !== 'paid') {
        throw new Error(`Expected paid, got ${camp.financePaymentStatus}`);
      }
      if (Number(camp.paidAmount) !== 15500) throw new Error('paidAmount not synced to camp');
      if (!camp.transactionId) throw new Error('transactionId missing');
      if (Number(camp.balance) !== 0) throw new Error(`Expected balance 0, got ${camp.balance}`);
    });
  }

  await runStep(`${label}: audit trail`, async () => {
    const audits = await findAudits(campMongoId);
    if (!audits.length) throw new Error('No audit logs for camp');
    const actions = audits.map((a) => String(a.action || ''));
    const need = ['approve', 'submit_to_finance', 'FINANCE.CAMP_PAYOUT'];
    for (const fragment of need) {
      if (!actions.some((action) => action.includes(fragment))) {
        throw new Error(`Missing audit action containing "${fragment}". Got: ${actions.slice(0, 12).join(', ')}`);
      }
    }
  });
}

async function createViaDashboard() {
  const slot = nextCreateSlot();
  const res = await api('/camp-ops/camps', {
    method: 'POST',
    body: {
      clientName: CAMP_ONE_DEMO.clientName,
      campaignType: CAMP_ONE_DEMO.campaignType,
      campaignName: CAMP_ONE_DEMO.method,
      source: 'dashboard',
      campDate: slot.campDate,
      requestDate: isoToday(),
      startTime: slot.startTime,
      endTime: slot.endTime,
      doctorName: `Dashboard Qa Doctor ${slot.uniq}`,
      doctorCode: `QA-DASH-${slot.uniq}`.slice(0, 28),
      campAddress: '10 Dashboard Road, Pune, Maharashtra 411001',
      city: 'Pune',
      district: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
      hq: 'Pune',
      zone: 'West Zone',
      expectedPatients: 40,
      fieldPersonName: 'Dashboard Contact',
      fieldPersonPhone: '9000000001',
      contactPersons: [
        { level: 'Territory Manager', name: 'Dashboard Contact', phone: '9000000001' },
      ],
      lifecycleStage: 'request',
    },
  });
  if (!res.data?._id) throw new Error('Dashboard create failed');
  if (res.data.source !== 'dashboard') throw new Error(`Expected source dashboard, got ${res.data.source}`);
  assertStatus(res.data, 'pending_review');
  return res.data;
}

async function createViaPaste() {
  const slot = nextCreateSlot();
  const text = `
Client: ${CAMP_ONE_DEMO.clientName}
Campaign Type: ${CAMP_ONE_DEMO.campaignType}
Campaign Name: ${CAMP_ONE_DEMO.method}
Date: ${formatDdMmYyyy(slot.campDate)}
Doctor Name: Paste Qa Doctor ${slot.uniq}
Doctor Code: QA-PASTE-${slot.uniq}
Camp Address: 22 Paste Lane, Pune, Maharashtra 411004
Expected Patients: 35
SE Name: Paste Contact
SE Mobile: 9000000002
${slot.startTime}
${slot.endTime}
`.trim();

  const extract = await api('/camp-ops/communications/paste/extract', {
    method: 'POST',
    body: {
      text,
      clientName: CAMP_ONE_DEMO.clientName,
      campaignType: CAMP_ONE_DEMO.campaignType,
      campaignName: CAMP_ONE_DEMO.method,
    },
  });
  const preview = extract.data;
  if (!preview?.bodyPreview?.length) throw new Error('Paste extract returned no rows');
  const firstRow = preview.bodyPreview[0];
  if (firstRow.valid === false) {
    throw new Error(`Paste extract invalid: ${(firstRow.errors || []).join('; ')}`);
  }

  const processed = await api('/camp-ops/communications/paste/process', {
    method: 'POST',
    body: {
      previewData: preview,
      clientName: CAMP_ONE_DEMO.clientName,
      campaignType: CAMP_ONE_DEMO.campaignType,
      campaignName: CAMP_ONE_DEMO.method,
    },
  });
  const created = (processed.data?.results || processed.data || []).find(
    (row) => row.status === 'created' || row.status === 'created_partial',
  );
  if (!created?.id) {
    throw new Error(`Paste process did not create camp: ${JSON.stringify(processed.data).slice(0, 400)}`);
  }
  const camp = await getCamp(created.id);
  if (camp.source !== 'paste') throw new Error(`Expected source paste, got ${camp.source}`);
  assertStatus(camp, 'pending_review');
  if (camp.requestIncomplete) {
    await api(`/camp-ops/camps/${camp._id}`, {
      method: 'PUT',
      body: {
        editingStage: 'request',
        lifecycleOnly: false,
        doctorName: camp.doctorName || `Paste Qa Doctor ${slot.uniq}`,
        doctorCode: camp.doctorCode || `QA-PASTE-${slot.uniq}`.slice(0, 28),
        campAddress: camp.campAddress || '22 Paste Lane, Pune, Maharashtra 411004',
        city: camp.city || 'Pune',
        district: camp.district || 'Pune',
        state: camp.state || 'Maharashtra',
        pincode: camp.pincode || '411004',
        hq: camp.hq || 'Pune',
        zone: camp.zone || 'West Zone',
        fieldPersonName: camp.fieldPersonName || 'Paste Contact',
        fieldPersonPhone: camp.fieldPersonPhone || '9000000002',
        contactPersons: camp.contactPersons?.length
          ? camp.contactPersons
          : [{ level: 'Territory Manager', name: 'Paste Contact', phone: '9000000002' }],
        expectedPatients: camp.expectedPatients || 35,
        startTime: camp.startTime || slot.startTime,
        endTime: camp.endTime || slot.endTime,
        campDate: camp.campDate || slot.campDate,
        requestDate: camp.requestDate || isoToday(),
        campaignType: camp.campaignType || CAMP_ONE_DEMO.campaignType,
        campaignName: camp.campaignName || CAMP_ONE_DEMO.method,
        clientName: camp.clientName || CAMP_ONE_DEMO.clientName,
        source: 'paste',
      },
    });
  }
  return await getCamp(created.id);
}

async function createViaExcelImport() {
  const slot = nextCreateSlot();
  const headers = [
    'Client',
    'Campaign Type',
    'Campaign Name',
    'Camp Date',
    'Start Time',
    'End Time',
    'Doctor Name',
    'Doctor Code',
    'Camp Address',
    'City',
    'District',
    'State',
    'Pincode',
    'Expected Patients',
    'SE Name',
    'SE Mobile',
  ];
  const rows = [
    {
      Client: CAMP_ONE_DEMO.clientName,
      'Campaign Type': CAMP_ONE_DEMO.campaignType,
      'Campaign Name': CAMP_ONE_DEMO.method,
      'Camp Date': slot.campDate,
      'Start Time': slot.startTime,
      'End Time': slot.endTime,
      'Doctor Name': `Excel Qa Doctor ${slot.uniq}`,
      'Doctor Code': `QA-XLS-${slot.uniq}`.slice(0, 28),
      'Camp Address': '33 Excel Avenue, Pune, Maharashtra 411005',
      City: 'Pune',
      District: 'Pune',
      State: 'Maharashtra',
      Pincode: '411005',
      'Expected Patients': '42',
      'SE Name': 'Excel Contact',
      'SE Mobile': '9000000003',
    },
  ];
  const mapping = {
    clientName: 'Client',
    campaignType: 'Campaign Type',
    campaignName: 'Campaign Name',
    campDate: 'Camp Date',
    startTime: 'Start Time',
    endTime: 'End Time',
    doctorName: 'Doctor Name',
    doctorCode: 'Doctor Code',
    campAddress: 'Camp Address',
    city: 'City',
    district: 'District',
    state: 'State',
    pincode: 'Pincode',
    expectedPatients: 'Expected Patients',
    fieldPersonName: 'SE Name',
    fieldPersonPhone: 'SE Mobile',
  };

  const confirmed = await api('/camp-ops/import/confirm', {
    method: 'POST',
    body: {
      rows,
      mapping,
      defaultClientName: CAMP_ONE_DEMO.clientName,
      headers,
    },
  });
  const created = confirmed.created?.[0] || confirmed.data?.created?.[0];
  const id = created?._id || created?.id;
  if (!id) {
    throw new Error(`Excel import confirm failed: ${JSON.stringify(confirmed).slice(0, 500)}`);
  }
  let camp = await getCamp(id);
  if (camp.source !== 'excel') throw new Error(`Expected source excel, got ${camp.source}`);
  assertStatus(camp, 'pending_review');

  await api(`/camp-ops/camps/${camp._id}`, {
    method: 'PUT',
    body: {
      editingStage: 'request',
      lifecycleOnly: false,
      clientName: CAMP_ONE_DEMO.clientName,
      campaignType: CAMP_ONE_DEMO.campaignType,
      campaignName: CAMP_ONE_DEMO.method,
      source: 'excel',
      doctorName: camp.doctorName || `Excel Qa Doctor ${slot.uniq}`,
      doctorCode: camp.doctorCode || `QA-XLS-${slot.uniq}`.slice(0, 28),
      campAddress: camp.campAddress || '33 Excel Avenue, Pune, Maharashtra 411005',
      city: camp.city || 'Pune',
      district: camp.district || 'Pune',
      state: camp.state || 'Maharashtra',
      pincode: camp.pincode || '411005',
      hq: camp.hq || 'Pune',
      zone: camp.zone || 'West Zone',
      fieldPersonName: camp.fieldPersonName || 'Excel Contact',
      fieldPersonPhone: camp.fieldPersonPhone || '9000000003',
      expectedPatients: camp.expectedPatients || 42,
      startTime: camp.startTime || slot.startTime,
      endTime: camp.endTime || slot.endTime,
      campDate: camp.campDate || slot.campDate,
      requestDate: camp.requestDate || isoToday(),
    },
  });
  camp = await getCamp(id);
  return camp;
}

async function createViaParser() {
  const slot = nextCreateSlot();
  const text = `
Date : ${formatDdMmYyyy(slot.campDate)}
Dr Name : Parser Qa Doctor ${slot.uniq}
Doctor Code : QA-PARSE-${slot.uniq}
Camp Address : 44 Parser Street, Pune, Maharashtra 411006
Expected Patients : 38
Start Time : ${slot.startTime}
End Time : ${slot.endTime}
SE Name : Parser Contact
SE Mobile : 9000000004
`.trim();

  const parsed = await api('/camp-ops/communications/parser/parse', {
    method: 'POST',
    body: {
      text,
      clientId: 'generic',
      clientName: CAMP_ONE_DEMO.clientName,
      storeAudit: true,
    },
  });
  const parsedFields = parsed.data?.parsed_fields || parsed.data?.parsedFields || parsed.parsed_fields;
  if (!parsedFields) throw new Error('Parser parse returned no parsed_fields');
  if (!parsedFields.camp_date) {
    throw new Error(`Parser missed camp_date: ${JSON.stringify(parsedFields)}`);
  }

  const processed = await api('/camp-ops/communications/parser/process', {
    method: 'POST',
    body: {
      parsedFields,
      pinMaster: parsed.data?.pin_master || null,
      clientName: CAMP_ONE_DEMO.clientName,
      campaignType: CAMP_ONE_DEMO.campaignType,
      campaignName: CAMP_ONE_DEMO.method,
    },
  });
  if (!processed.data?._id) {
    throw new Error(`Parser process failed: ${JSON.stringify(processed).slice(0, 400)}`);
  }
  const camp = await getCamp(processed.data._id);
  if (camp.source !== 'parser') throw new Error(`Expected source parser, got ${camp.source}`);
  assertStatus(camp, 'pending_review');
  return camp;
}

async function main() {
  stamp = Date.now().toString(36).slice(-6);
  console.log('\nCamp One Lifecycle QA — seeding…');
  await connectDb();
  await ensureSeed();
  await ensureCampOpsSeed();
  await disconnectDb();

  console.log(`  Demo admin: ${CAMP_ONE_DEMO.adminEmail}`);
  console.log('\nCamp One Lifecycle QA — 4 creation methods × full lifecycle\n');

  await runStep('Login', async () => {
    const login = await api('/auth/login', {
      method: 'POST',
      auth: false,
      body: { email: CAMP_ONE_DEMO.adminEmail, password: CAMP_ONE_DEMO.adminPassword },
    });
    token = login.data?.accessToken || login.accessToken;
    if (!token) throw new Error('No access token');
  });

  await runStep('Resolve HCW contact', async () => {
    const res = await api('/contacts?contactCategory=Healthcare%20Worker&limit=100');
    const contacts = Array.isArray(res.data) ? res.data : (res.data?.data || []);
    const hcw = contacts.find((c) => c.name === CAMP_ONE_DEMO.hcwName) || contacts[0];
    if (!hcw?._id) throw new Error('No HCW contact available');
    hcwContactId = hcw._id;
  });

  const camps = {};

  await runStep('Create #1 — Dashboard form', async () => {
    camps.dashboard = await createViaDashboard();
    console.log(`      campId=${camps.dashboard.campId} source=${camps.dashboard.source}`);
  });

  await runStep('Create #2 — Manual paste', async () => {
    camps.paste = await createViaPaste();
    console.log(`      campId=${camps.paste.campId} source=${camps.paste.source}`);
  });

  await runStep('Create #3 — Excel import', async () => {
    camps.excel = await createViaExcelImport();
    console.log(`      campId=${camps.excel.campId} source=${camps.excel.source}`);
  });

  await runStep('Create #4 — Client request parser', async () => {
    camps.parser = await createViaParser();
    console.log(`      campId=${camps.parser.campId} source=${camps.parser.source}`);
  });

  for (const [method, camp] of Object.entries(camps)) {
    if (!camp?._id) continue;
    console.log(`\n── Lifecycle: ${method.toUpperCase()} (${camp.campId}) ──`);
    await processLifecycle(method, camp._id, { markPaid: true });
  }

  await runStep('Dashboard stats still load', async () => {
    const stats = await api('/camp-ops/dashboard/stats');
    if (stats?.camps?.total == null) throw new Error('Missing dashboard stats');
  });

  await runStep('Ops overview dashboard loads', async () => {
    const overview = await api('/dashboards/overview');
    if (!overview.data?.kpis && !overview.kpis && !overview.data?.generatedAt && !overview.generatedAt) {
      if (!overview.data && !overview.generatedAt) throw new Error('Overview payload empty');
    }
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log('\n────────────────────────────────────────────────');
  console.log(`Results: ${passed}/${results.length} passed`);
  if (failed.length) {
    console.log('\nFailed steps:');
    failed.forEach((f) => console.log(`  • ${f.name}: ${f.message}`));
    process.exitCode = 1;
  } else {
    console.log('\nAll multi-method lifecycle QA scenarios passed.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
