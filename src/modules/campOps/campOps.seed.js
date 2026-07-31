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

export const CAMP_ONE_DEMO = {
  adminEmail: 'campadmin@tylo.local',
  adminPassword: 'CampDemoPass123!',
  clientName: 'Demo Pharma Ltd',
  clientCode: 'DEMOPHAR',
  division: 'Screening',
  method: 'BMD',
  hcwName: 'Ravi Technician',
};

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function baseCampFields({ client, campDate, doctorSuffix = 'A' }) {
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
    doctorName: `Dr. Demo ${doctorSuffix}`,
    doctorCode: `DOC${doctorSuffix}`,
    campAddress: '12 MG Road, Pune, Maharashtra 411001',
    city,
    state,
    pincode: '411001',
    hq: city,
    zone,
    expectedPatients: 50,
    fieldPersonName: 'Amit Sharma',
    fieldPersonPhone: '9876543210',
    remarks: '',
    lifecycleStage: 'request',
    assignmentStatus: 'Pending',
    executionStatus: 'Camp Scheduled',
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

async function ensureDemoClient() {
  let client = await CampOpsClient.findOne({ isDeleted: false, name: CAMP_ONE_DEMO.clientName });
  if (!client) {
    client = await CampOpsClient.create({
      name: CAMP_ONE_DEMO.clientName,
      code: CAMP_ONE_DEMO.clientCode,
      isActive: true,
    });
  }
  return client;
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

async function ensureHcwContact() {
  const email = 'ravi.tech@demo.tylo.local';
  let contact = await Contact.findOne({ email, isDeleted: false });
  if (!contact) {
    contact = await Contact.create({
      name: CAMP_ONE_DEMO.hcwName,
      email,
      contactCategory: 'Healthcare Worker',
      profession: 'Technician',
      contact: '9123456780',
      mobile: '9123456780',
      city: 'Pune',
      state: 'Maharashtra',
      pinCode: '411001',
    });
  }
  return contact;
}

async function ensureDemoCamp({ key, client, hcw, overrides = {} }) {
  const existing = await CampOpsCamp.findOne({ isDeleted: false, doctorCode: `DEMO-${key}` });
  if (existing) return { created: false, camp: existing };

  const campDate = overrides.campDate || addDays(new Date().toISOString().slice(0, 10), 14);
  const base = baseCampFields({ client, campDate, doctorSuffix: key });
  const tracking = captureSubmissionTracking();

  const camp = await CampOpsCamp.create({
    ...base,
    ...overrides,
    doctorCode: `DEMO-${key}`,
    campId: await generateCampId(campDate),
    createdByEmail: CAMP_ONE_DEMO.adminEmail,
    requestReviewStatus: overrides.requestReviewStatus || 'review_pending',
    ...tracking,
  });

  return { created: true, camp };
}

export async function ensureCampOpsSeed() {
  const admin = await ensureDemoAdmin();
  const client = await ensureDemoClient();
  await ensureClientMaster(client);
  const hcw = await ensureHcwContact();

  const today = new Date().toISOString().slice(0, 10);

  const camps = await Promise.all([
    ensureDemoCamp({
      key: 'REQ',
      client,
      hcw,
      overrides: {
        status: 'pending_review',
        lifecycleStage: 'request',
        requestReviewStatus: 'review_pending',
        campDate: addDays(today, 10),
      },
    }),
    ensureDemoCamp({
      key: 'INFO',
      client,
      hcw,
      overrides: {
        status: 'pending_review',
        lifecycleStage: 'request',
        requestReviewStatus: 'information_requested',
        informationRequestNote: 'Please confirm doctor contact number.',
        campDate: addDays(today, 12),
      },
    }),
    ensureDemoCamp({
      key: 'ASGN',
      client,
      hcw,
      overrides: {
        status: 'approved',
        lifecycleStage: 'assignment',
        assignmentDecision: '',
        assignmentStatus: 'Pending',
        campDate: addDays(today, 15),
      },
    }),
    ensureDemoCamp({
      key: 'EXEC',
      client,
      hcw,
      overrides: {
        status: 'approved',
        lifecycleStage: 'execution',
        assignmentDecision: 'assign',
        assignmentStatus: 'Assigned',
        hcwContactId: hcw._id,
        hcwCategory: 'Technician',
        hcwName: hcw.name,
        hcwContact: hcw.mobile || hcw.contact,
        campDate: addDays(today, 18),
      },
    }),
    ensureDemoCamp({
      key: 'FIN',
      client,
      hcw,
      overrides: {
        status: 'executed',
        lifecycleStage: 'financial',
        assignmentDecision: 'assign',
        assignmentStatus: 'Assigned',
        hcwContactId: hcw._id,
        hcwCategory: 'Technician',
        hcwName: hcw.name,
        hcwContact: hcw.mobile || hcw.contact,
        executionStatus: 'Camp Completed',
        patientsCount: 42,
        actualPatients: 42,
        campDate: addDays(today, 5),
        executedAt: new Date().toISOString(),
      },
    }),
  ]);

  const repaired = await repairExecutedCampLifecycleStages();
  if (repaired) {
    console.log(`[camp-ops] Moved ${repaired} executed camp(s) to Finance & Settlement stage`);
  }

  return {
    admin,
    client,
    hcw,
    camps: camps.map((item) => item.camp),
    createdCamps: camps.filter((item) => item.created).length,
  };
}
