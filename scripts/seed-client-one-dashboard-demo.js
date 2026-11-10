/**
 * Local-only temp camps for Client One dashboard preview.
 * Targets Demo Pharma Ltd · Demo Screening Program · BMD (active access Z5TRZUPYMF).
 *
 * Usage: node scripts/seed-client-one-dashboard-demo.js
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import { CampOpsCamp } from '../src/modules/campOps/campOps.model.js';
import {
  computeClientOneDashboardAnalytics,
  computeClientOneKpis,
} from '../src/modules/clientOne/clientOne.service.js';

const SEED_TAG = '[client-one-dashboard-seed]';
const CLIENT_ID = 'b3ab395cd4e9dfb9fc38b2bf';
const CLIENT_NAME = 'Demo Pharma Ltd';
const PROGRAM = 'Demo Screening Program';
const METHOD = 'BMD';

const templates = [
  // Executed — mix of billing, punctuality, extra hours, request lead time
  {
    day: '01', requestOffset: 8, status: 'executed', patients: 48, doctor: 'Dr. Ananya Rao', mr: 'Vivek Sharma', state: 'Bihar',
    chargeableStatus: 'Chargeable', startTime: '09:00', inTime: '09:02', extraHours: 0.5,
  },
  {
    day: '02', requestOffset: 2, status: 'executed', patients: 36, doctor: 'Dr. Ananya Rao', mr: 'Vivek Sharma', state: 'Bihar',
    chargeableStatus: 'Chargeable', startTime: '09:00', inTime: '09:08', extraHours: 1.2,
  },
  {
    day: '03', requestOffset: 10, status: 'executed', patients: 52, doctor: 'Dr. Kabir Mehta', mr: 'Sibananda Senapati', state: 'Odisha',
    chargeableStatus: 'Non-Chargeable', startTime: '10:00', inTime: '10:18', extraHours: 0,
  },
  {
    day: '04', requestOffset: 1, status: 'executed', patients: 28, doctor: 'Dr. Kabir Mehta', mr: 'Sibananda Senapati', state: 'Odisha',
    chargeableStatus: 'Chargeable', startTime: '09:30', inTime: '10:05', extraHours: 5.5,
  },
  {
    day: '05', requestOffset: 6, status: 'executed', patients: 61, doctor: 'Dr. Neha Kulkarni', mr: 'Ravi Gupta', state: 'Maharashtra',
    chargeableStatus: 'Chargeable', startTime: '08:30', inTime: '08:30', extraHours: 2,
  },
  {
    day: '06', requestOffset: 3, status: 'executed', patients: 44, doctor: 'Dr. Neha Kulkarni', mr: 'Ravi Gupta', state: 'Maharashtra',
    chargeableStatus: 'Non-Chargeable', startTime: '09:00', inTime: '09:25', extraHours: 4.5,
  },
  {
    day: '07', requestOffset: 12, status: 'executed', patients: 39, doctor: 'Dr. Farhan Qureshi', mr: 'Vivek Sharma', state: 'Bihar',
    chargeableStatus: 'Chargeable', startTime: '11:00', inTime: '11:04', extraHours: 0.2,
  },
  {
    day: '08', requestOffset: 4, status: 'executed', patients: 33, doctor: 'Dr. Farhan Qureshi', mr: 'Sibananda Senapati', state: 'Odisha',
    chargeableStatus: 'Chargeable', startTime: '09:00', inTime: '09:40', extraHours: 6,
  },
  {
    day: '09', requestOffset: 7, status: 'executed', patients: 55, doctor: 'Dr. Ananya Rao', mr: 'Ravi Gupta', state: 'Maharashtra',
    chargeableStatus: 'Chargeable', startTime: '09:00', inTime: '09:06', extraHours: 1,
  },
  {
    day: '10', requestOffset: 0, status: 'executed', patients: 41, doctor: 'Dr. Kabir Mehta', mr: 'Vivek Sharma', state: 'Bihar',
    chargeableStatus: 'Non-Chargeable', startTime: '10:00', inTime: '10:12', extraHours: 3.5,
  },
  // Cancellations — Camp One Cancelled by Client / Cancelled by Tylo taxonomy
  {
    day: '03', requestOffset: 9, status: 'cancelled', cancelledBy: 'brand', patients: 0, doctor: 'Dr. Priya Nair', mr: 'Vivek Sharma', state: 'Kerala',
    closureReasonCategory: 'Client Decision', closureSubReason: 'client_cancelled', closureSubReasonLabel: 'Client Cancelled',
  },
  {
    day: '04', requestOffset: 2, status: 'cancelled', cancelledBy: 'brand', patients: 0, doctor: 'Dr. Priya Nair', mr: 'Ravi Gupta', state: 'Maharashtra',
    closureReasonCategory: 'Client Decision', closureSubReason: 'client_rescheduled', closureSubReasonLabel: 'Client Rescheduled',
  },
  {
    day: '05', requestOffset: 11, status: 'cancelled', cancelledBy: 'khw', patients: 0, doctor: 'Dr. Rohan Iyer', mr: 'Sibananda Senapati', state: 'Odisha',
    closureReasonCategory: 'Resource Issue', closureSubReason: 'hcw_unavailability', closureSubReasonLabel: 'HCW Unavailability',
  },
  {
    day: '06', requestOffset: 5, status: 'cancelled', cancelledBy: 'khw', patients: 0, doctor: 'Dr. Rohan Iyer', mr: 'Vivek Sharma', state: 'Bihar',
    closureReasonCategory: 'Resource Issue', closureSubReason: 'hcw_backout', closureSubReasonLabel: 'HCW Backout',
  },
  {
    day: '07', requestOffset: 8, status: 'cancelled', cancelledBy: 'khw', patients: 0, doctor: 'Dr. Meera Joshi', mr: 'Ravi Gupta', state: 'Maharashtra',
    closureReasonCategory: 'Operational Issue', closureSubReason: 'punctuality', closureSubReasonLabel: 'Punctuality',
  },
  {
    day: '08', requestOffset: 1, status: 'cancelled', cancelledBy: 'khw', patients: 0, doctor: 'Dr. Meera Joshi', mr: 'Sibananda Senapati', state: 'Odisha',
    closureReasonCategory: 'Device & Inventory', closureSubReason: 'device_failure', closureSubReasonLabel: 'Device Failure',
  },
  {
    day: '02', requestOffset: 14, status: 'cancelled', cancelledBy: 'khw', patients: 0, doctor: 'Dr. Arjun Desai', mr: 'Vivek Sharma', state: 'Gujarat',
    closureReasonCategory: 'External Factors', closureSubReason: 'adverse_weather', closureSubReasonLabel: 'Adverse Weather',
  },
  {
    day: '01', requestOffset: 3, status: 'cancelled', cancelledBy: 'brand', patients: 0, doctor: 'Dr. Arjun Desai', mr: 'Ravi Gupta', state: 'Maharashtra',
    closureReasonCategory: 'Client Decision', closureSubReason: 'client_cancelled', closureSubReasonLabel: 'Client Cancelled',
  },
  // Planned (no chargeability yet)
  {
    day: '09', requestOffset: 6, status: 'approved', patients: 0, doctor: 'Dr. Kavya Shah', mr: 'Sibananda Senapati', state: 'Odisha',
  },
  {
    day: '10', requestOffset: 2, status: 'pending_review', patients: 0, doctor: 'Dr. Kavya Shah', mr: 'Vivek Sharma', state: 'Bihar',
  },
];

function ymdOffset(campDay, offsetDays) {
  const camp = new Date(`2026-11-${campDay}T12:00:00.000Z`);
  const req = new Date(camp);
  req.setUTCDate(req.getUTCDate() - Number(offsetDays || 0));
  const y = req.getUTCFullYear();
  const m = String(req.getUTCMonth() + 1).padStart(2, '0');
  const d = String(req.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function main() {
  await connectDb();

  const existing = await CampOpsCamp.find({
    clientId: CLIENT_ID,
    campaignType: PROGRAM,
    campaignName: METHOD,
    isDeleted: false,
  });
  const priorSeed = (Array.isArray(existing) ? existing : []).filter((row) =>
    String(row.remarks || '').includes(SEED_TAG));

  for (const row of priorSeed) {
    row.isDeleted = true;
    row.deletedAt = new Date().toISOString();
    row.remarks = `${SEED_TAG} removed ${new Date().toISOString()}`;
    await row.save();
  }

  const created = [];
  for (let i = 0; i < templates.length; i += 1) {
    const t = templates[i];
    const campDate = `2026-11-${t.day}`;
    const doc = await CampOpsCamp.create({
      campId: `C1-DEMO-${String(i + 1).padStart(3, '0')}`,
      clientId: CLIENT_ID,
      clientName: CLIENT_NAME,
      campaignType: PROGRAM,
      campaignName: METHOD,
      campDate,
      requestDate: ymdOffset(t.day, t.requestOffset),
      submittedAt: `${ymdOffset(t.day, t.requestOffset)}T09:00:00.000Z`,
      status: t.status,
      lifecycleStage: t.status === 'executed' || t.status === 'cancelled' ? 'execution' : 'request',
      executionStatus: t.status === 'executed'
        ? 'Camp Completed'
        : t.status === 'cancelled'
          ? (t.cancelledBy === 'brand' ? 'Cancelled by Client' : 'Cancelled by Tylo')
          : 'Camp Scheduled',
      cancelledBy: t.cancelledBy || '',
      closureReasonCategory: t.closureReasonCategory || '',
      closureSubReason: t.closureSubReason || '',
      closureSubReasonLabel: t.closureSubReasonLabel || '',
      cancellationReason: t.closureSubReason || '',
      doctorName: t.doctor,
      fieldPersonName: t.mr,
      contactPersons: [
        { level: 'Territory Manager', code: 'TM', name: t.mr, phone: '9999900000' },
      ],
      state: t.state,
      city: t.state,
      campAddress: `${t.state} demo clinic`,
      actualPatients: t.patients,
      expectedPatients: Math.max(t.patients, 20),
      chargeableStatus: t.chargeableStatus || '',
      startTime: t.startTime || '09:00',
      endTime: '13:00',
      inTime: t.inTime || '',
      outTime: t.status === 'executed' ? '13:00' : '',
      clientMasterCampDuration: '4:00',
      durationHours: 4,
      extraHours: t.extraHours ?? 0,
      punctuality: '',
      source: 'dashboard',
      isActive: true,
      isDeleted: false,
      remarks: `${SEED_TAG} temp dashboard preview data`,
    });
    created.push(doc);
  }

  const scoped = await CampOpsCamp.find({
    clientId: CLIENT_ID,
    campaignType: PROGRAM,
    campaignName: METHOD,
    isDeleted: false,
  });
  const kpis = computeClientOneKpis(scoped, {
    from: '2026-11-01',
    to: '2026-11-10',
    now: new Date('2026-11-10T12:00:00.000Z'),
  });
  const analytics = computeClientOneDashboardAnalytics(scoped);

  console.log(JSON.stringify({
    removedPriorSeed: priorSeed.length,
    created: created.length,
    scopedTotal: Array.isArray(scoped) ? scoped.length : 0,
    kpis: {
      campCount: kpis.campCount,
      patientsScreened: kpis.patientsScreened,
      uniqueDoctors: kpis.uniqueDoctors,
    },
    chartTotals: Object.fromEntries(
      Object.entries(analytics.charts).map(([k, v]) => [k, v.total]),
    ),
    topDoctors: analytics.leaderboards.doctors.map((d) => d.name),
    topMrs: analytics.leaderboards.mrs.map((m) => m.name),
  }, null, 2));

  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  try { await disconnectDb(); } catch { /* ignore */ }
  process.exit(1);
});
