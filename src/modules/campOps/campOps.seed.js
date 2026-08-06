import bcrypt from 'bcryptjs';
import { Role } from '../users/role.model.js';
import { User } from '../users/user.model.js';
import { Contact } from '../contacts/contact.model.js';
import {
  CampOpsCamp,
  CampOpsClient,
  CampOpsClientMaster,
} from './campOps.model.js';
import { generateCampId, captureSubmissionTracking } from './campOps.helpers.js';
import { repairExecutedCampLifecycleStages } from './campOps.lifecycle.js';
import { resolveZoneNameForState } from '../geo/geo.zones.js';
import { campFinanceExpenseDefaults } from './campFinanceExpense.js';
import { LogisticsExpenseSubCategory } from '../logistics/logistics.model.js';

export const CAMP_ONE_DEMO = {
  adminEmail: 'campadmin@tylo.local',
  adminPassword: 'CampDemoPass123!',
  clientName: 'Demo Pharma Ltd',
  clientCode: 'DEMOPHAR',
  division: 'Screening',
  method: 'BMD',
  hcwName: 'Ravi Technician',
};

export const CAMP_ONE_DEMO_CLIENTS = [
  { name: 'Demo Pharma Ltd', code: 'DEMOPHAR' },
  { name: 'Apex Diagnostics', code: 'APEXDIAG' },
  { name: 'CareWell Clinics', code: 'CAREWELL' },
];

export const CAMP_ONE_DEMO_HCWS = [
  {
    key: 'tech',
    name: 'Ravi Technician',
    email: 'ravi.tech@demo.tylo.local',
    profession: 'Technician',
    category: 'Technician',
    mobile: '9123456780',
  },
  {
    key: 'phleb',
    name: 'Neha Phlebotomist',
    email: 'neha.phleb@demo.tylo.local',
    profession: 'Phlebotomist',
    category: 'Phlebotomist',
    mobile: '9123456781',
  },
  {
    key: 'diet',
    name: 'Asha Dietician',
    email: 'asha.diet@demo.tylo.local',
    profession: 'Dietician',
    category: 'Dietician',
    mobile: '9123456782',
  },
];

/** Demo camps use doctorCode DEMO-{key} and are upserted on every seed run. */
export const DEMO_CAMP_KEYS = [
  'REQ', 'INFO', 'REJ', 'CANR',
  'ASGN', 'ASGD',
  'EXEC', 'ONGO', 'EXMK',
  'FIN', 'FINSB', 'FINCF', 'FINHD', 'FINPY',
  'PQ01', 'PQ02', 'PQ03', 'PQ04', 'PQ05', 'PQ06', 'PQ07', 'PQ08', 'PQ09', 'PQ10',
];

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function baseCampFields({ client, campDate, label }) {
  const state = 'Maharashtra';
  const city = 'Pune';
  const zone = resolveZoneNameForState(state) || 'West Zone';
  return {
    clientId: client._id,
    clientName: client.name,
    campaignType: CAMP_ONE_DEMO.division,
    campaignName: CAMP_ONE_DEMO.method,
    source: 'dashboard',
    campDate,
    requestDate: new Date().toISOString().slice(0, 10),
    startTime: '09:00',
    endTime: '12:00',
    durationHours: 3,
    campSlot: 'Morning',
    doctorName: label,
    doctorCode: '',
    campAddress: '12 MG Road, Pune, Maharashtra 411001',
    city,
    state,
    pincode: '411001',
    hq: city,
    zone,
    expectedPatients: 50,
    fieldPersonName: 'Amit Sharma',
    fieldPersonPhone: '9876543210',
    remarks: 'Demo camp for stage testing',
    lifecycleStage: 'request',
    assignmentStatus: 'Pending',
    executionStatus: 'Camp Scheduled',
    isDeleted: false,
  };
}

function hcwAssignmentFields(hcw) {
  return {
    assignmentDecision: 'assign',
    assignmentStatus: 'Assigned',
    hcwContactId: hcw._id,
    hcwCategory: 'Technician',
    hcwName: hcw.name,
    hcwContact: hcw.mobile || hcw.contact,
  };
}

function executionCompleteFields() {
  return {
    executionStatus: 'Camp Completed',
    chargeableStatus: 'Chargeable',
    inTime: '09:05',
    outTime: '12:10',
    totalHours: 3.08,
    patientsCount: 42,
    actualPatients: 42,
    consumablesUsed: [{ item: 'Gloves', quantity: 2, unit: 'box' }],
  };
}

function financialPayoutFields() {
  return {
    campAmount: 15000,
    travelling: 500,
    overtimeExpense: 0,
    otherExpenses: 0,
    totalPayout: 15500,
    paidAmount: 0,
    balance: 15500,
  };
}

async function ensureDemoAdmin() {
  const adminRole = await Role.findOne({ name: 'Admin', isDeleted: false });
  if (!adminRole) return null;

  let user = await User.findOne({ email: CAMP_ONE_DEMO.adminEmail });
  if (!user) {
    const passwordHash = await bcrypt.hash(CAMP_ONE_DEMO.adminPassword, 12);
    user = await User.create({
      email: CAMP_ONE_DEMO.adminEmail,
      username: 'campadmin',
      fullName: 'Camp One Demo Admin',
      passwordHash,
      roleIds: [adminRole._id],
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    });
    return { created: true, user };
  }

  return { created: false, user };
}

async function ensureDemoClients() {
  const clients = {};
  for (const entry of CAMP_ONE_DEMO_CLIENTS) {
    let client = await CampOpsClient.findOne({ isDeleted: false, name: entry.name });
  if (!client) {
    client = await CampOpsClient.create({
        name: entry.name,
        code: entry.code,
      isActive: true,
    });
    } else if (!client.code) {
      client.code = entry.code;
      await client.save();
    }
    clients[entry.code] = client;
  }
  return clients;
}

async function ensureDemoClient() {
  const clients = await ensureDemoClients();
  return clients.DEMOPHAR;
}

async function ensureClientMaster(client) {
  const existing = await CampOpsClientMaster.findOne({
    isDeleted: false,
    clientId: String(client._id),
    drugTherapyName: CAMP_ONE_DEMO.division,
    campName: CAMP_ONE_DEMO.method,
  });
  if (existing) return existing;

  return CampOpsClientMaster.create({
    clientId: client._id,
    clientName: client.name,
    programName: 'Demo Screening Program',
    drugTherapyName: CAMP_ONE_DEMO.division,
    campName: CAMP_ONE_DEMO.method,
    campType: 'Camp',
    coordinatorName: 'Demo Coordinator',
    healthcareWorker: CAMP_ONE_DEMO.hcwName,
    poAmount: 25000,
    campDuration: '3 Hours',
    spocName: 'SPOC Demo',
    spocNumber: '9998887776',
    requestTimeline: '7 days',
    isActive: true,
  });
}

async function ensureHcwContacts() {
  const byKey = {};
  for (const entry of CAMP_ONE_DEMO_HCWS) {
    const financeReady = {
      name: entry.name,
      email: entry.email,
      contactCategory: 'Healthcare Worker',
      profession: entry.profession,
      contact: entry.mobile,
      mobile: entry.mobile,
      city: 'Pune',
      state: 'Maharashtra',
      pinCode: '411001',
      address: '12 Demo Lane, Pune, Maharashtra 411001',
      panNumber: 'ABCDE1234F',
      ifscCode: 'HDFC0000212',
      bankName: 'HDFC Bank',
      accountNumber: `5010012345678${entry.key.length}`,
      passbookCopyUrl: `/uploads/demo/${entry.key}-passbook.pdf`,
      panCardCopyUrl: `/uploads/demo/${entry.key}-pan.pdf`,
    };
    let contact = await Contact.findOne({ email: entry.email, isDeleted: false });
    if (!contact) {
      contact = await Contact.create(financeReady);
    } else {
      Object.assign(contact, financeReady);
      await contact.save();
    }
    byKey[entry.key] = contact;
  }
  return byKey;
}

async function ensureHcwContact() {
  const contacts = await ensureHcwContacts();
  return contacts.tech;
}

function hcwFieldsFromContact(hcw, category) {
  return {
    assignmentDecision: 'assign',
    assignmentStatus: 'Assigned',
    hcwContactId: hcw._id,
    hcwCategory: category || hcw.profession || 'Technician',
    hcwName: hcw.name,
    hcwContact: hcw.mobile || hcw.contact,
  };
}

function payoutAmounts(total = 15500) {
  const travelling = 500;
  const campAmount = Math.max(0, total - travelling);
  return {
    campAmount,
    travelling,
    overtimeExpense: 0,
    otherExpenses: 0,
    totalPayout: total,
    paidAmount: 0,
    balance: total,
  };
}

function buildFinancePayoutDemoCamps({ clients, hcws, today }) {
  const execComplete = executionCompleteFields();
  const scenarios = [
    {
      key: 'PQ01',
      clientCode: 'DEMOPHAR',
      hcwKey: 'tech',
      division: 'Screening',
      method: 'BMD',
      campDate: addDays(today, -3),
      total: 15500,
      status: 'under_review',
      label: 'Dr. Pivot Pharma BMD Tech',
    },
    {
      key: 'PQ02',
      clientCode: 'DEMOPHAR',
      hcwKey: 'phleb',
      division: 'Screening',
      method: 'BMD',
      campDate: addDays(today, -4),
      total: 9800,
      status: 'not_paid',
      label: 'Dr. Pivot Pharma BMD Phleb',
    },
    {
      key: 'PQ03',
      clientCode: 'DEMOPHAR',
      hcwKey: 'diet',
      division: 'Metabolic',
      method: 'Dietician',
      campDate: addDays(today, -40),
      total: 7200,
      status: 'under_review',
      label: 'Dr. Pivot Pharma Diet',
    },
    {
      key: 'PQ04',
      clientCode: 'APEXDIAG',
      hcwKey: 'tech',
      division: 'Ortho',
      method: 'BMD',
      campDate: addDays(today, -2),
      total: 18200,
      status: 'under_review',
      label: 'Dr. Pivot Apex BMD Tech',
    },
    {
      key: 'PQ05',
      clientCode: 'APEXDIAG',
      hcwKey: 'tech',
      division: 'Ortho',
      method: 'Neuro',
      campDate: addDays(today, -8),
      total: 21000,
      status: 'not_paid',
      label: 'Dr. Pivot Apex Neuro Tech',
    },
    {
      key: 'PQ06',
      clientCode: 'APEXDIAG',
      hcwKey: 'phleb',
      division: 'Cardio',
      method: 'Lipidocare',
      campDate: addDays(today, -35),
      total: 11400,
      status: 'under_review',
      label: 'Dr. Pivot Apex Lipid Phleb',
    },
    {
      key: 'PQ07',
      clientCode: 'CAREWELL',
      hcwKey: 'phleb',
      division: 'Screening',
      method: 'Vitamin D3',
      campDate: addDays(today, -1),
      total: 8600,
      status: 'under_review',
      label: 'Dr. Pivot CareWell VitD Phleb',
    },
    {
      key: 'PQ08',
      clientCode: 'CAREWELL',
      hcwKey: 'diet',
      division: 'Metabolic',
      method: 'Dietician',
      campDate: addDays(today, -6),
      total: 6400,
      status: 'not_paid',
      label: 'Dr. Pivot CareWell Diet',
    },
    {
      key: 'PQ09',
      clientCode: 'CAREWELL',
      hcwKey: 'tech',
      division: 'Ortho',
      method: 'BMD',
      campDate: addDays(today, -45),
      total: 15000,
      status: 'paid',
      paidAmount: 15000,
      transactionId: 'DEMO-UTR-PQ09',
      label: 'Dr. Pivot CareWell BMD Paid',
    },
    {
      key: 'PQ10',
      clientCode: 'DEMOPHAR',
      hcwKey: 'tech',
      division: 'Ortho',
      method: 'Uroflow',
      campDate: addDays(today, -12),
      total: 13300,
      status: 'under_review',
      label: 'Dr. Pivot Pharma Uroflow Tech',
    },
  ];

  return scenarios.map((entry) => {
    const client = clients[entry.clientCode];
    const hcw = hcws[entry.hcwKey];
    const amounts = payoutAmounts(entry.total);
    if (entry.status === 'paid') {
      amounts.paidAmount = entry.paidAmount ?? entry.total;
      amounts.balance = Math.max(0, entry.total - amounts.paidAmount);
    }
    return {
      key: entry.key,
      client,
      overrides: {
        status: 'executed',
        lifecycleStage: 'financial',
        requestReviewStatus: 'approved',
        doctorName: entry.label,
        clientName: client.name,
        campaignType: entry.division,
        campaignName: entry.method,
        campDate: entry.campDate,
        executedAt: `${entry.campDate}T10:00:00.000Z`,
        paymentSubmitStatus: 'payment_confirmed',
        financePaymentStatus: entry.status,
        ...campFinanceExpenseDefaults(),
        submittedToFinanceAt: `${addDays(entry.campDate, 1)}T11:00:00.000Z`,
        submittedToFinanceByEmail: CAMP_ONE_DEMO.adminEmail,
        transactionId: entry.transactionId || '',
        paymentRemark: entry.status === 'paid' ? 'Demo paid payout' : 'Demo finance queue row',
        ...hcwFieldsFromContact(hcw, CAMP_ONE_DEMO_HCWS.find((h) => h.key === entry.hcwKey)?.category),
        ...execComplete,
        ...amounts,
      },
    };
  });
}

async function ensureDemoCamp({ key, client, overrides = {} }) {
  const doctorCode = `DEMO-${key}`;
  // Prefer an active row when duplicates exist (purge can leave soft-deleted copies).
  const existing =
    (await CampOpsCamp.findOne({ doctorCode, isDeleted: false })) ||
    (await CampOpsCamp.findOne({ doctorCode }));
  const label = overrides.doctorName || `Dr. Demo ${key}`;
  const campDate = overrides.campDate || addDays(new Date().toISOString().slice(0, 10), 14);
  const base = baseCampFields({ client, campDate, label });
  const tracking = captureSubmissionTracking();

  const payload = {
    ...base,
    ...overrides,
    doctorCode,
    doctorName: label,
    campId: existing?.campId || await generateCampId(campDate),
    createdByEmail: CAMP_ONE_DEMO.adminEmail,
    requestReviewStatus: overrides.requestReviewStatus ?? 'review_pending',
    isDeleted: false,
    deletedAt: null,
    ...(existing ? {} : tracking),
  };

  if (existing) {
    Object.assign(existing, payload);
    await existing.save();
    return { created: false, updated: true, camp: existing };
  }

  const camp = await CampOpsCamp.create(payload);
  return { created: true, updated: false, camp };
}

function buildDemoCampDefinitions({ client, hcw, today }) {
  const hcwFields = hcwAssignmentFields(hcw);
  const execComplete = executionCompleteFields();
  const payout = financialPayoutFields();

  return [
    {
      key: 'REQ',
      label: 'Dr. Demo REQ (Review Pending)',
      overrides: {
        status: 'pending_review',
        lifecycleStage: 'request',
        requestReviewStatus: 'review_pending',
        campDate: addDays(today, 10),
      },
    },
    {
      key: 'INFO',
      label: 'Dr. Demo INFO (Info Requested)',
      overrides: {
        status: 'pending_review',
        lifecycleStage: 'request',
        requestReviewStatus: 'information_requested',
        informationRequestNote: 'Please confirm doctor contact number.',
        campDate: addDays(today, 12),
      },
    },
    {
      key: 'REJ',
      label: 'Dr. Demo REJ (Rejected)',
      overrides: {
        status: 'rejected',
        lifecycleStage: 'request',
        requestReviewStatus: 'rejected',
        rejectionReason: 'Demo rejection for testing',
        campDate: addDays(today, 8),
      },
    },
    {
      key: 'CANR',
      label: 'Dr. Demo CANR (Cancelled)',
      overrides: {
        status: 'cancelled',
        lifecycleStage: 'request',
        requestReviewStatus: 'cancelled',
        cancelledBy: 'brand',
        remarks: 'Cancelled by client for demo',
        campDate: addDays(today, 7),
      },
    },
    {
      key: 'ASGN',
      label: 'Dr. Demo ASGN (Unassigned)',
      overrides: {
        status: 'approved',
        lifecycleStage: 'assignment',
        requestReviewStatus: 'approved',
        assignmentDecision: '',
        assignmentStatus: 'Pending',
        campDate: addDays(today, 15),
      },
    },
    {
      key: 'ASGD',
      label: 'Dr. Demo ASGD (Assigned)',
      overrides: {
        status: 'approved',
        lifecycleStage: 'assignment',
        requestReviewStatus: 'approved',
        campDate: addDays(today, 16),
        ...hcwFields,
      },
    },
    {
      key: 'EXEC',
      label: 'Dr. Demo EXEC (Scheduled)',
      overrides: {
        status: 'approved',
        lifecycleStage: 'execution',
        requestReviewStatus: 'approved',
        executionStatus: 'Camp Scheduled',
        campDate: addDays(today, 18),
        ...hcwFields,
      },
    },
    {
      key: 'ONGO',
      label: 'Dr. Demo ONGO (Ongoing)',
      overrides: {
        status: 'approved',
        lifecycleStage: 'execution',
        requestReviewStatus: 'approved',
        executionStatus: 'Camp Ongoing',
        campDate: today,
        startTime: '08:00',
        endTime: '20:00',
        inTime: '08:05',
        ...hcwFields,
      },
    },
    {
      key: 'EXMK',
      label: 'Dr. Demo EXMK (Marked Executed)',
      overrides: {
        status: 'approved',
        lifecycleStage: 'execution',
        requestReviewStatus: 'approved',
        executionStatus: 'Marked Executed',
        campDate: addDays(today, -1),
        startTime: '09:00',
        endTime: '11:00',
        inTime: '09:02',
        outTime: '11:05',
        ...hcwFields,
      },
    },
    {
      key: 'FIN',
      label: 'Dr. Demo FIN (Pending Submission)',
      overrides: {
        status: 'executed',
        lifecycleStage: 'financial',
        requestReviewStatus: 'approved',
        campDate: addDays(today, 5),
        executedAt: new Date().toISOString(),
        paymentSubmitStatus: '',
        financePaymentStatus: 'not_paid',
        submittedToFinanceAt: null,
        ...hcwFields,
        ...execComplete,
        ...payout,
      },
    },
    {
      key: 'FINSB',
      label: 'Dr. Demo FINSB (Submitted)',
      overrides: {
        status: 'executed',
        lifecycleStage: 'financial',
        requestReviewStatus: 'approved',
        campDate: addDays(today, 4),
        executedAt: addDays(today, 3) + 'T10:00:00.000Z',
        paymentSubmitStatus: 'payment_not_checked',
        financePaymentStatus: 'under_review',
        ...campFinanceExpenseDefaults(),
        submittedToFinanceAt: new Date().toISOString(),
        submittedToFinanceByEmail: CAMP_ONE_DEMO.adminEmail,
        ...hcwFields,
        ...execComplete,
        ...payout,
      },
    },
    {
      key: 'FINCF',
      label: 'Dr. Demo FINCF (Payment Verified)',
      overrides: {
        status: 'executed',
        lifecycleStage: 'financial',
        requestReviewStatus: 'approved',
        campDate: addDays(today, 3),
        executedAt: addDays(today, 2) + 'T10:00:00.000Z',
        paymentSubmitStatus: 'payment_confirmed',
        financePaymentStatus: 'under_review',
        ...campFinanceExpenseDefaults(),
        submittedToFinanceAt: addDays(today, 1) + 'T12:00:00.000Z',
        submittedToFinanceByEmail: CAMP_ONE_DEMO.adminEmail,
        ...hcwFields,
        ...execComplete,
        ...payout,
      },
    },
    {
      key: 'FINHD',
      label: 'Dr. Demo FINHD (Payment On Hold)',
      overrides: {
        status: 'executed',
        lifecycleStage: 'financial',
        requestReviewStatus: 'approved',
        campDate: addDays(today, 2),
        executedAt: addDays(today, 1) + 'T10:00:00.000Z',
        paymentSubmitStatus: 'payment_hold',
        paymentRemark: 'Demo hold — awaiting invoice',
        financePaymentStatus: 'under_review',
        ...campFinanceExpenseDefaults(),
        submittedToFinanceAt: addDays(today, 1) + 'T14:00:00.000Z',
        submittedToFinanceByEmail: CAMP_ONE_DEMO.adminEmail,
        ...hcwFields,
        ...execComplete,
        ...payout,
      },
    },
    {
      key: 'FINPY',
      label: 'Dr. Demo FINPY (Paid)',
      overrides: {
        status: 'executed',
        lifecycleStage: 'financial',
        requestReviewStatus: 'approved',
        campDate: addDays(today, 1),
        executedAt: today + 'T09:00:00.000Z',
        paymentSubmitStatus: 'payment_confirmed',
        financePaymentStatus: 'paid',
        transactionId: 'DEMO-UTR-0001',
        ...campFinanceExpenseDefaults(),
        submittedToFinanceAt: addDays(today, -1) + 'T11:00:00.000Z',
        submittedToFinanceByEmail: CAMP_ONE_DEMO.adminEmail,
        ...hcwFields,
        ...execComplete,
        ...payout,
        paidAmount: 15500,
        balance: 0,
      },
    },
  ].map((entry) => ({
    key: entry.key,
    client,
    overrides: {
      ...entry.overrides,
      doctorName: entry.label,
    },
  }));
}

export async function ensureCampOpsSeed() {
  const admin = await ensureDemoAdmin();
  const clients = await ensureDemoClients();
  const client = clients.DEMOPHAR;
  await ensureClientMaster(client);
  const hcws = await ensureHcwContacts();
  const hcw = hcws.tech;

  const expenseDefaults = campFinanceExpenseDefaults();
  const expenseSub = await LogisticsExpenseSubCategory.findOne({
    isDeleted: false,
    isActive: true,
    name: expenseDefaults.expenseSubCategory,
    categoryName: expenseDefaults.expenseCategory,
  });
  const expenseFields = {
    ...expenseDefaults,
    expenseSubCategoryId: expenseSub?._id || null,
  };

  const today = new Date().toISOString().slice(0, 10);
  const definitions = [
    ...buildDemoCampDefinitions({ client, hcw, today }),
    ...buildFinancePayoutDemoCamps({ clients, hcws, today }),
  ].map((def) => {
    if (!def.overrides?.submittedToFinanceAt) return def;
    return {
      ...def,
      overrides: {
        ...def.overrides,
        ...expenseFields,
      },
    };
  });
  const camps = [];
  for (const def of definitions) {
    camps.push(await ensureDemoCamp(def));
  }

  const repaired = await repairExecutedCampLifecycleStages();
  if (repaired) {
    console.log(`[camp-ops] Moved ${repaired} executed camp(s) to Finance & Settlement stage`);
  }

  const createdCamps = camps.filter((item) => item.created).length;
  const updatedCamps = camps.filter((item) => item.updated).length;
  const payoutQueue = camps
    .map((item) => item.camp)
    .filter((camp) => camp?.submittedToFinanceAt);

  console.log(`[camp-ops] Finance payout queue demo rows: ${payoutQueue.length}`);

  return {
    admin,
    client,
    clients,
    hcw,
    hcws,
    camps: camps.map((item) => item.camp),
    createdCamps,
    updatedCamps,
    payoutQueueCount: payoutQueue.length,
  };
}
