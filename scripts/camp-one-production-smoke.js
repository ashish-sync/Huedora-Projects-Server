/**
 * Camp One — controlled production smoke test (Render + Mongo Atlas).
 *
 * Read-only checks + one disposable camp (doctorCode prefix PROD-SMOKE-).
 * Requires Admin or user with camps:approve + finance:write.
 *
 *   PROD_SMOKE_EMAIL=... PROD_SMOKE_PASSWORD=... \
 *   API_BASE=https://huedora-projects-server.onrender.com/api/v1 \
 *   node scripts/camp-one-production-smoke.js
 *
 * Set PROD_SMOKE_SKIP_MUTATIONS=1 for read-only mode (no camp create).
 */
import { getHcwFinanceBlockers } from '../src/modules/contacts/hcwFinanceReadiness.js';

const base = (
  process.env.API_BASE
  || process.env.PROD_API_BASE
  || 'https://huedora-projects-server.onrender.com/api/v1'
).replace(/\/$/, '');

const email = process.env.PROD_SMOKE_EMAIL || process.env.SMOKE_EMAIL;
const password = process.env.PROD_SMOKE_PASSWORD || process.env.SMOKE_PASSWORD;
const skipMutations = String(process.env.PROD_SMOKE_SKIP_MUTATIONS || '').toLowerCase() === '1';

const VALID_LIFECYCLE_STAGES = new Set(['request', 'assignment', 'execution', 'financial']);
const VALID_STATUSES = new Set(['pending_review', 'approved', 'rejected', 'cancelled', 'executed']);
const VALID_PAYMENT_SUBMIT = new Set([
  'payment_not_checked',
  'payment_confirmed',
  'payment_hold',
]);
const VALID_FINANCE_PAYMENT = new Set(['not_paid', 'under_review', 'paid']);

const results = [];
let token = '';
let stamp = '';
let hcwContactId = '';
let clientMaster = null;

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, error) {
  const message = error?.message || String(error);
  results.push({ name, ok: false, message });
  console.error(`  ✗ ${name}: ${message}`);
}

async function runStep(name, fn) {
  try {
    const detail = await fn();
    pass(name, detail || '');
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

async function getCamp(id) {
  const res = await api(`/camp-ops/camps/${id}`);
  if (!res.data?._id) throw new Error('Camp detail missing');
  return res.data;
}

function rowsOf(res) {
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.data?.data)) return res.data.data;
  return [];
}

function assertEnum(value, allowed, label) {
  const v = String(value || '').trim();
  if (v && !allowed.has(v)) {
    throw new Error(`Invalid ${label}: "${v}"`);
  }
}

async function resolveClientMasterCatalog() {
  const clients = rowsOf(await api('/camp-ops/clients?limit=20'));
  const client = clients.find((c) => c.isActive !== false) || clients[0];
  if (!client?.name) throw new Error('No active Camp One client in production');

  const masters = rowsOf(await api(`/camp-ops/client-masters?clientId=${encodeURIComponent(client._id)}&limit=50`));
  const master = masters.find((m) => m.isActive !== false && m.campName) || masters[0];
  if (!master) throw new Error(`No Client Master row for ${client.name}`);

  const campaignType = String(master.programName || master.drugTherapyName || '').trim();
  const campaignName = String(master.campName || '').trim();
  if (!campaignType || !campaignName) {
    throw new Error('Client Master missing division/method labels');
  }
  return { client, master, campaignType, campaignName };
}

async function main() {
  stamp = Date.now().toString(36).slice(-6).toUpperCase();
  console.log('\nCamp One Production Smoke');
  console.log(`API: ${base}`);
  console.log(`Stamp: PROD-SMOKE-${stamp}`);
  console.log(`Mode: ${skipMutations ? 'read-only' : 'controlled mutation (1 disposable camp)'}\n`);

  if (!email || !password) {
    console.error('Set PROD_SMOKE_EMAIL and PROD_SMOKE_PASSWORD (or SMOKE_EMAIL / SMOKE_PASSWORD).');
    process.exit(1);
  }

  await runStep('Health + public config', async () => {
    const health = await api('/health', { auth: false });
    if (!health?.data?.live) throw new Error('Health not live');
    const pub = await api('/config/public', { auth: false });
    return `status=${health.data.status}; ts=${health.data.ts}; publicKeys=${Object.keys(pub.data || {}).length}`;
  });

  await runStep('Login + permissions', async () => {
    const login = await api('/auth/login', {
      method: 'POST',
      auth: false,
      body: { email, password },
    });
    token = login.data?.accessToken || login.accessToken;
    if (!token) throw new Error('No access token');

    const me = await api('/auth/me');
    const perms = me.data?.permissions || me.permissions || [];
    const permSet = new Set(perms);
    const need = ['camps:read', 'camps:request', 'camps:approve'];
    const missing = need.filter((p) => !permSet.has(p) && !permSet.has('all'));
    if (missing.length) throw new Error(`Missing permissions: ${missing.join(', ')}`);
    const financeOk = permSet.has('finance:write') || permSet.has('all');
    return `${me.data?.email || email}; finance:write=${financeOk}`;
  });

  await runStep('Dashboard stats + overview', async () => {
    const stats = await api('/camp-ops/dashboard/stats');
    if (stats?.camps?.total == null) throw new Error('Missing camp dashboard stats');
    const overview = await api('/dashboards/overview');
    const kpis = overview.data?.kpis || overview.kpis;
    return `camps.total=${stats.camps.total}; overviewKpis=${kpis ? Object.keys(kpis).length : 0}`;
  });

  await runStep('Stage/status filters (read-only)', async () => {
    const checks = [
      ['/camp-ops/camps?lifecycleStage=request&limit=5', 'request'],
      ['/camp-ops/camps?lifecycleStage=assignment&assignmentFilter=unassigned&limit=5', 'assignment'],
      ['/camp-ops/camps?lifecycleStage=execution&executionFilter=scheduled&limit=5', 'execution'],
      ['/camp-ops/camps?lifecycleStage=financial&financialFilter=payment_not_checked&limit=5', 'financial'],
    ];
    for (const [path, stage] of checks) {
      const res = await api(path);
      const rows = rowsOf(res);
      if (!Array.isArray(rows)) throw new Error(`${stage} filter returned non-array`);
    }
    return `${checks.length} filter endpoints OK`;
  });

  await runStep('No invalid lifecycleStage/status in sample', async () => {
    const res = await api('/camp-ops/camps?limit=100');
    const rows = rowsOf(res);
    const invalid = [];
    for (const camp of rows) {
      try {
        assertEnum(camp.lifecycleStage, VALID_LIFECYCLE_STAGES, 'lifecycleStage');
        assertEnum(camp.status, VALID_STATUSES, 'status');
        if (camp.paymentSubmitStatus) {
          assertEnum(camp.paymentSubmitStatus, VALID_PAYMENT_SUBMIT, 'paymentSubmitStatus');
        }
        if (camp.financePaymentStatus) {
          assertEnum(camp.financePaymentStatus, VALID_FINANCE_PAYMENT, 'financePaymentStatus');
        }
      } catch (err) {
        invalid.push(`${camp.campId || camp._id}: ${err.message}`);
      }
    }
    if (invalid.length) {
      throw new Error(`${invalid.length} invalid row(s): ${invalid.slice(0, 3).join('; ')}`);
    }
    return `${rows.length} camp(s) sampled`;
  });

  await runStep('HCW contacts available (finance-ready)', async () => {
    const res = await api('/contacts?contactCategory=Healthcare%20Worker&limit=100');
    const contacts = rowsOf(res);
    const ready = contacts.filter(
      (c) => c.isActive !== false && getHcwFinanceBlockers(c).length === 0,
    );
    const hcw = ready[0] || contacts.find((c) => c.isActive !== false) || contacts[0];
    if (!hcw?._id) throw new Error('No HCW contact in production');
    hcwContactId = hcw._id;
    const financeReady = ready.some((c) => String(c._id) === String(hcw._id));
    if (!financeReady) {
      throw new Error(
        `No finance-ready HCW found (${contacts.length} total). Complete Contact Directory payout fields before production smoke.`,
      );
    }
    return `${hcw.name} (${ready.length} finance-ready of ${contacts.length})`;
  });

  await runStep('Client Master catalog resolves', async () => {
    clientMaster = await resolveClientMasterCatalog();
    return `${clientMaster.client.name} / ${clientMaster.campaignType} / ${clientMaster.campaignName}`;
  });

  if (skipMutations) {
    console.log('\nPROD_SMOKE_SKIP_MUTATIONS=1 — skipping disposable camp workflow.\n');
  } else {
    let campId = '';
    let campMongoId = '';
    const campDate = addDaysIso(isoToday(), 120);
    const doctorCode = `PROD-SMOKE-${stamp}`;

    await runStep('Create disposable camp (Request)', async () => {
      const res = await api('/camp-ops/camps', {
        method: 'POST',
        body: {
          clientName: clientMaster.client.name,
          campaignType: clientMaster.campaignType,
          campaignName: clientMaster.campaignName,
          source: 'dashboard',
          campDate,
          requestDate: isoToday(),
          startTime: '14:30',
          endTime: '17:30',
          doctorName: `Prod Smoke Doctor ${stamp}`,
          doctorCode,
          campAddress: 'Production Smoke Test Address, Pune, Maharashtra 411001',
          city: 'Pune',
          district: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
          hq: 'Pune',
          zone: 'West Zone',
          expectedPatients: 10,
          fieldPersonName: 'Prod Smoke Contact',
          fieldPersonPhone: '9000000099',
          contactPersons: [
            { level: 'Territory Manager', name: 'Prod Smoke Contact', phone: '9000000099' },
          ],
          lifecycleStage: 'request',
          remarks: `DISPOSABLE PRODUCTION SMOKE TEST ${stamp} — safe to archive/delete`,
        },
      });
      const camp = res.data;
      if (!camp?._id) throw new Error('Create failed');
      campMongoId = camp._id;
      campId = camp.campId;
      if (camp.status !== 'pending_review') throw new Error(`Expected pending_review, got ${camp.status}`);
      return campId;
    });

    await runStep('Confirm (approve) → Assignment', async () => {
      await api(`/camp-ops/camps/${campMongoId}/approve`, { method: 'POST' });
      const camp = await getCamp(campMongoId);
      if (camp.status !== 'approved') throw new Error(`status=${camp.status}`);
      if (camp.lifecycleStage !== 'assignment') throw new Error(`stage=${camp.lifecycleStage}`);
      return camp.lifecycleStage;
    });

    await runStep('Assign HCW → Execution immediately', async () => {
      await api(`/camp-ops/camps/${campMongoId}`, {
        method: 'PUT',
        body: {
          editingStage: 'assignment',
          lifecycleStage: 'assignment',
          lifecycleOnly: false,
          assignmentDecision: 'assign',
          hcwContactId,
          hcwCategory: 'Technician',
          hcwName: 'Production Smoke HCW',
          hcwContact: '9000000000',
          campDate,
          startTime: '14:30',
          endTime: '17:30',
          hcwGapOverrideAcknowledged: true,
        },
      });
      const camp = await getCamp(campMongoId);
      if (camp.lifecycleStage !== 'execution') {
        throw new Error(`Expected execution immediately, got ${camp.lifecycleStage}`);
      }
      return camp.executionStatus || 'n/a';
    });

    await runStep('Planned → Executed → Mark Complete', async () => {
      await api(`/camp-ops/camps/${campMongoId}`, {
        method: 'PUT',
        body: {
          editingStage: 'execution',
          lifecycleStage: 'execution',
          lifecycleOnly: false,
          chargeableStatus: 'Chargeable',
          inTime: '14:35',
          attire: 'No Issues',
          labCoat: 'No Issues',
          outTime: '17:20',
          kmRoundTrip: 25,
          patientsCount: 8,
          actualPatients: 8,
          rxCount: 2,
          hcwGapOverrideAcknowledged: true,
          executionDocuments: [
            { docType: 'doctor_form', fileName: 'df-prod-smoke.pdf', url: 'https://example.local/df-prod-smoke.pdf' },
            { docType: 'patient_form', fileName: 'pf-prod-smoke.pdf', url: 'https://example.local/pf-prod-smoke.pdf' },
          ],
          markComplete: true,
        },
      });
      const camp = await getCamp(campMongoId);
      if (camp.lifecycleStage !== 'financial') throw new Error(`stage=${camp.lifecycleStage}`);
      if (camp.status !== 'executed') throw new Error(`status=${camp.status}`);
      return camp.executionStatus;
    });

    await runStep('Financial amounts + Hold → Release → Confirm Payment', async () => {
      await api(`/camp-ops/camps/${campMongoId}`, {
        method: 'PUT',
        body: {
          editingStage: 'financial',
          lifecycleStage: 'financial',
          maxLifecycleStage: 'financial',
          lifecycleOnly: true,
          campAmount: 1000,
          travelling: 100,
          campRevenue: 1500,
          hcwGapOverrideAcknowledged: true,
        },
      });
      await api(`/camp-ops/camps/${campMongoId}/confirm-payment`, { method: 'POST' });
      let camp = await getCamp(campMongoId);
      if (camp.paymentSubmitStatus !== 'payment_confirmed') {
        throw new Error(`confirm failed: ${camp.paymentSubmitStatus}`);
      }

      await api(`/camp-ops/camps/${campMongoId}/hold`, {
        method: 'POST',
        body: { paymentRemark: `PROD-SMOKE hold test ${stamp}` },
      });
      camp = await getCamp(campMongoId);
      if (camp.paymentSubmitStatus !== 'payment_hold') throw new Error('hold not applied');

      await api(`/camp-ops/camps/${campMongoId}/release-hold`, { method: 'POST' });
      camp = await getCamp(campMongoId);
      if (camp.paymentSubmitStatus !== 'payment_confirmed') throw new Error('release hold failed');
      return 'hold cycle OK';
    });

    await runStep('Submit to Finance One + Payment Done', async () => {
      await api(`/camp-ops/camps/${campMongoId}/submit-to-finance`, {
        method: 'POST',
        body: { paymentSubmitStatus: 'payment_confirmed' },
      });
      let camp = await getCamp(campMongoId);
      if (!camp.submittedToFinanceAt) throw new Error('not submitted');
      if (camp.financePaymentStatus !== 'under_review') {
        throw new Error(`financePaymentStatus=${camp.financePaymentStatus}`);
      }

      const payouts = rowsOf(await api('/finance/camp-payouts?limit=50'));
      if (!payouts.some((row) => String(row._id) === String(campMongoId))) {
        throw new Error('Camp missing from finance camp-payouts');
      }

      await api(`/finance/camp-payouts/${campMongoId}`, {
        method: 'PATCH',
        body: {
          financePaymentStatus: 'paid',
          paidAmount: 1100,
          transactionId: `PROD-SMOKE-UTR-${stamp}`,
          paymentDate: isoToday(),
          paymentRemark: `DISPOSABLE smoke payout ${stamp}`,
        },
      });
      camp = await getCamp(campMongoId);
      if (camp.financePaymentStatus !== 'paid') throw new Error('not paid');
      return `UTR=PROD-SMOKE-UTR-${stamp}; campId=${campId}`;
    });

    await runStep('Cancellation path — Assignment refuse blocked vs Execution cancel', async () => {
      // Assignment-stage cancel must fail (read rules on disposable camp still in financial — use new camp)
      const res = await api('/camp-ops/camps', {
        method: 'POST',
        body: {
          clientName: clientMaster.client.name,
          campaignType: clientMaster.campaignType,
          campaignName: clientMaster.campaignName,
          source: 'dashboard',
          campDate: addDaysIso(isoToday(), 121),
          requestDate: isoToday(),
          startTime: '09:00',
          endTime: '12:00',
          doctorName: `Prod Smoke Cancel ${stamp}`,
          doctorCode: `PROD-SMOKE-CXL-${stamp}`,
          campAddress: 'Cancel smoke, Pune, Maharashtra 411001',
          city: 'Pune',
          district: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
          hq: 'Pune',
          zone: 'West Zone',
          expectedPatients: 5,
          fieldPersonName: 'Cancel Contact',
          fieldPersonPhone: '9000000088',
          contactPersons: [
            { level: 'Territory Manager', name: 'Cancel Contact', phone: '9000000088' },
          ],
          lifecycleStage: 'request',
          remarks: `DISPOSABLE cancel smoke ${stamp}`,
        },
      });
      const cancelCampId = res.data._id;
      await api(`/camp-ops/camps/${cancelCampId}/approve`, { method: 'POST' });

      let blocked = false;
      try {
        await api(`/camp-ops/camps/${cancelCampId}/close`, {
          method: 'POST',
          body: {
            closureType: 'Cancelled by Tylo',
            reasonCategory: 'Resource Issue',
            subReason: 'hcw_unavailability',
            chargeableStatus: 'Non-Chargeable',
          },
        });
      } catch (err) {
        blocked = /assignment|Execution|Refused/i.test(err.message);
      }
      if (!blocked) throw new Error('Assignment cancel should be blocked');

      await api(`/camp-ops/camps/${cancelCampId}`, {
        method: 'PUT',
        body: {
          editingStage: 'assignment',
          lifecycleStage: 'assignment',
          lifecycleOnly: false,
          assignmentDecision: 'assign',
          hcwContactId,
          hcwCategory: 'Technician',
          hcwName: 'Production Smoke HCW',
          hcwContact: '9000000000',
          campDate: addDaysIso(isoToday(), 121),
          startTime: '09:00',
          endTime: '12:00',
          hcwGapOverrideAcknowledged: true,
        },
      });

      await api(`/camp-ops/camps/${cancelCampId}/close`, {
        method: 'POST',
        body: {
          closureType: 'Cancelled by Tylo',
          reasonCategory: 'Resource Issue',
          subReason: 'hcw_unavailability',
          chargeableStatus: 'Non-Chargeable',
        },
      });
      const closed = await getCamp(cancelCampId);
      if (closed.status !== 'cancelled') throw new Error('Execution cancel failed');
      if (closed.lifecycleStage !== 'financial') throw new Error(`cancel stage=${closed.lifecycleStage}`);
      return `main=${campId}; cancelCamp=${closed.campId}`;
    });

    await runStep('Audit trail on disposable camp', async () => {
      const res = await fetch(`${base}/audit-logs?entityType=camp_ops_camp&entityId=${encodeURIComponent(campMongoId)}&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) {
        return 'skipped — operator lacks audit:read (workflow actions still logged server-side)';
      }
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message || `HTTP ${res.status}`);
      }
      const json = await res.json();
      const rows = rowsOf(json);
      if (!rows.length) throw new Error('No audit logs');
      const actions = rows.map((r) => String(r.action || ''));
      const need = ['approve', 'confirm_payment', 'submit_to_finance'];
      for (const frag of need) {
        if (!actions.some((a) => a.includes(frag))) {
          throw new Error(`Missing audit action: ${frag}`);
        }
      }
      return `${rows.length} audit row(s)`;
    });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`Production smoke: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('\nFailed:');
    failed.forEach((f) => console.log(`  • ${f.name}: ${f.message}`));
    process.exitCode = 1;
  } else {
    console.log('\nAll production smoke checks passed.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
