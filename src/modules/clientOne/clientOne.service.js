import { createHash, randomBytes, randomInt } from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/helpers.js';
import { CampOpsCamp, CampOpsClientMaster } from '../campOps/campOps.model.js';
import { normalizeCampName } from '../campOps/campOps.constants.js';
import {
  CAMP_CLOSURE_TAXONOMY,
  findClosureSubReason,
  normalizeClosureSubReason,
} from '../campOps/campOps.closure.js';
import {
  computeLifecycleDerived,
  campSnapshotPricing,
  isCampExecutedForPayout,
  resolveCancelledClosureExecutionStatus,
} from '../campOps/campOps.lifecycle.js';
import {
  classifyChargeabilityBucket,
  classifyPunctualityBucket,
} from '../dashboards/campQuality.metrics.js';
import { ClientOneAccess } from './clientOne.model.js';
import { normalizeClientOneFeatures } from './clientOne.features.js';

const PIN_LENGTH = 6;
const SESSION_TTL = '12h';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILED = 8;
const LOCK_MS = 15 * 60 * 1000;
const ACCESS_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PIN_PATTERN = /^\d{6}$/;

export function normalizeClientOnePin(raw) {
  const pin = String(raw || '').replace(/\D+/g, '');
  return PIN_PATTERN.test(pin) ? pin : '';
}

export function hashClientOnePin(raw) {
  const pin = normalizeClientOnePin(raw) || String(raw || '').trim();
  // Login still hashes only valid 6-digit pins; reject empty / non-PIN shapes.
  if (!PIN_PATTERN.test(String(pin || '').trim())) return null;
  return createHash('sha256').update(`client-one:${pin}`).digest('hex');
}

export function mintClientOnePin(length = PIN_LENGTH) {
  const size = PIN_LENGTH;
  void length;
  let pin = '';
  for (let i = 0; i < size; i += 1) {
    pin += String(randomInt(0, 10));
  }
  return pin;
}

export function resolveClientOnePinInput(requestedPin) {
  const custom = normalizeClientOnePin(requestedPin);
  if (requestedPin != null && String(requestedPin).trim() !== '') {
    if (!custom) {
      throw new AppError('PIN must be exactly 6 digits', 400, 'VALIDATION_ERROR');
    }
    return custom;
  }
  return mintClientOnePin();
}

export function mintClientOneAccessId(length = 10) {
  const size = Math.max(8, Math.min(16, Number(length) || 10));
  const bytes = randomBytes(size);
  let id = '';
  for (let i = 0; i < size; i += 1) {
    id += ACCESS_ID_ALPHABET[bytes[i] % ACCESS_ID_ALPHABET.length];
  }
  return id;
}

function trimStr(value) {
  return String(value || '').trim();
}

export function programmeKeysFromMaster(master = {}) {
  return {
    clientId: master.clientId || null,
    clientName: trimStr(master.clientName),
    programName: trimStr(master.programName || master.drugTherapyName),
    campName: normalizeCampName(master.campName || 'BMD'),
  };
}

export function buildCampScopeFilter(access) {
  return {
    isDeleted: false,
    clientId: access.clientId,
    campaignType: trimStr(access.programName),
    campaignName: normalizeCampName(access.campName || 'BMD'),
  };
}

export function publicAccessSummary(row) {
  if (!row) return null;
  return {
    accessId: row.accessId,
    clientMasterId: row.clientMasterId,
    clientId: row.clientId,
    clientName: row.clientName,
    programName: row.programName,
    campName: row.campName,
    isActive: row.isActive !== false,
    expiresAt: row.expiresAt || null,
    rotatedAt: row.rotatedAt || null,
    lastLoginAt: row.lastLoginAt || null,
    features: normalizeClientOneFeatures(row.features),
    path: `/o/${row.accessId}`,
    sharedPath: '/client-one',
  };
}

export async function updateClientOneAccessFeatures(masterId, featuresPatch = {}) {
  const row = await findActiveAccessForMaster(masterId);
  if (!row) throw new AppError('Client One access is not active for this programme', 404, 'NOT_FOUND');
  row.features = normalizeClientOneFeatures({
    ...normalizeClientOneFeatures(row.features),
    ...featuresPatch,
  });
  await row.save();
  return row;
}

export async function findActiveAccessForMaster(clientMasterId) {
  return ClientOneAccess.findOne({
    clientMasterId,
    isActive: true,
    revokedAt: null,
  });
}

export async function getAccessByAccessId(accessId) {
  const id = trimStr(accessId);
  if (!id) return null;
  return ClientOneAccess.findOne({ accessId: id, isActive: true, revokedAt: null });
}

export async function mintOrRotateClientOneAccess(master, actor = {}, { rotate = false, pin: requestedPin } = {}) {
  if (!master?._id) throw new AppError('Client master is required', 400, 'VALIDATION_ERROR');
  const keys = programmeKeysFromMaster(master);
  if (!keys.clientId || !keys.programName || !keys.campName) {
    throw new AppError(
      'Client Master needs Client, Division / Therapy, and Method before Client One access can be issued',
      400,
      'VALIDATION_ERROR',
    );
  }

  let existing = await findActiveAccessForMaster(master._id);
  if (existing && !rotate) {
    return {
      access: existing,
      pin: null,
      created: false,
      rotated: false,
      summary: {
        ...publicAccessSummary(existing),
        url: `${env.clientOrigin}/client-one`,
        deepUrl: `${env.clientOrigin}/o/${existing.accessId}`,
      },
    };
  }

  const customRequested = requestedPin != null && String(requestedPin).trim() !== '';
  let pin = resolveClientOnePinInput(requestedPin);
  let pinHash = hashClientOnePin(pin);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const clash = await ClientOneAccess.findOne({ pinHash, isActive: true, revokedAt: null });
    if (!clash || (existing && String(clash._id) === String(existing._id))) break;
    if (customRequested) {
      throw new AppError('That PIN is already in use. Choose a different 6-digit PIN.', 409, 'PIN_IN_USE');
    }
    pin = mintClientOnePin();
    pinHash = hashClientOnePin(pin);
  }

  let accessId = mintClientOneAccessId();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const clash = await ClientOneAccess.findOne({ accessId });
    if (!clash || (existing && String(clash._id) === String(existing._id))) break;
    accessId = mintClientOneAccessId();
  }

  const nowIso = new Date().toISOString();
  if (existing && rotate) {
    existing.pinHash = pinHash;
    existing.accessId = accessId;
    existing.clientId = keys.clientId;
    existing.clientName = keys.clientName;
    existing.programName = keys.programName;
    existing.campName = keys.campName;
    existing.rotatedAt = nowIso;
    existing.failedAttempts = 0;
    existing.lockedUntil = null;
    existing.isActive = true;
    existing.revokedAt = null;
    await existing.save();
    return {
      access: existing,
      pin,
      created: false,
      rotated: true,
      summary: {
        ...publicAccessSummary(existing),
        url: `${env.clientOrigin}/client-one`,
        deepUrl: `${env.clientOrigin}/o/${existing.accessId}`,
      },
    };
  }

  const created = await ClientOneAccess.create({
    clientMasterId: master._id,
    clientId: keys.clientId,
    clientName: keys.clientName,
    programName: keys.programName,
    campName: keys.campName,
    accessId,
    pinHash,
    isActive: true,
    createdById: actor.id || actor._id || null,
    createdByEmail: actor.email || '',
    failedAttempts: 0,
    features: normalizeClientOneFeatures(null),
  });

  return {
    access: created,
    pin,
    created: true,
    rotated: false,
    summary: {
      ...publicAccessSummary(created),
      url: `${env.clientOrigin}/client-one`,
      deepUrl: `${env.clientOrigin}/o/${created.accessId}`,
    },
  };
}

export async function revokeClientOneAccess(masterId) {
  const row = await findActiveAccessForMaster(masterId);
  if (!row) return null;
  row.isActive = false;
  row.revokedAt = new Date().toISOString();
  await row.save();
  return row;
}

/** External client session: change own PIN (not available for staff preview). */
export async function changeClientOnePin(access, { currentPin, newPin } = {}) {
  if (!access?._id || access.isPreview) {
    throw new AppError('PIN can only be changed from an active client session', 403, 'FORBIDDEN');
  }
  const currentHash = hashClientOnePin(currentPin);
  if (!currentHash || access.pinHash !== currentHash) {
    throw new AppError('Current PIN is incorrect', 401, 'INVALID_PIN');
  }
  const pin = resolveClientOnePinInput(newPin);
  if (pin === normalizeClientOnePin(currentPin)) {
    throw new AppError('New PIN must be different from the current PIN', 400, 'VALIDATION_ERROR');
  }
  const pinHash = hashClientOnePin(pin);
  const clash = await ClientOneAccess.findOne({ pinHash, isActive: true, revokedAt: null });
  if (clash && String(clash._id) !== String(access._id)) {
    throw new AppError('That PIN is already in use. Choose a different 6-digit PIN.', 409, 'PIN_IN_USE');
  }
  const row = await ClientOneAccess.findOne({ _id: access._id, isActive: true, revokedAt: null });
  if (!row) throw new AppError('Session no longer valid', 401, 'UNAUTHORIZED');
  row.pinHash = pinHash;
  row.rotatedAt = new Date().toISOString();
  row.failedAttempts = 0;
  row.lockedUntil = null;
  await row.save();
  return { accessId: row.accessId, pin };
}

function isLocked(access) {
  if (!access?.lockedUntil) return false;
  const until = new Date(access.lockedUntil).getTime();
  return Number.isFinite(until) && until > Date.now();
}

export async function verifyClientOnePin({ pin, accessId = '' } = {}) {
  const pinHash = hashClientOnePin(pin);
  if (!pinHash) throw new AppError('Enter a valid PIN', 400, 'VALIDATION_ERROR');

  let access = null;
  if (trimStr(accessId)) {
    access = await getAccessByAccessId(accessId);
    if (!access || access.pinHash !== pinHash) {
      if (access) await registerFailedPin(access);
      throw new AppError('Invalid PIN', 401, 'INVALID_PIN');
    }
  } else {
    access = await ClientOneAccess.findOne({
      pinHash,
      isActive: true,
      revokedAt: null,
    });
    if (!access) throw new AppError('Invalid PIN', 401, 'INVALID_PIN');
  }

  if (access.expiresAt && new Date(access.expiresAt).getTime() < Date.now()) {
    throw new AppError('This Client One access has expired', 403, 'ACCESS_EXPIRED');
  }
  if (isLocked(access)) {
    throw new AppError('Too many attempts. Try again later.', 429, 'PIN_LOCKED');
  }

  access.failedAttempts = 0;
  access.lockedUntil = null;
  access.lastLoginAt = new Date().toISOString();
  await access.save();
  return access;
}

async function registerFailedPin(access) {
  const next = Number(access.failedAttempts || 0) + 1;
  access.failedAttempts = next;
  if (next >= MAX_FAILED) {
    access.lockedUntil = new Date(Date.now() + LOCK_MS).toISOString();
    access.failedAttempts = 0;
  }
  await access.save();
}

export function signClientOneSession(access, { preview = false, actor = null } = {}) {
  const features = normalizeClientOneFeatures(access.features);
  const isPreview = preview === true;
  const payload = {
    typ: isPreview ? 'client_one_preview' : 'client_one',
    accessId: access.accessId,
    clientMasterId: String(access.clientMasterId),
    clientId: String(access.clientId),
    programName: access.programName,
    campName: access.campName,
    clientName: access.clientName,
    mode: isPreview ? 'preview' : 'external',
  };
  if (isPreview && (actor?.email || actor?.id)) {
    payload.previewBy = actor.email || String(actor.id);
  }
  const token = jwt.sign(payload, env.jwtAccessSecret, { expiresIn: SESSION_TTL });
  return {
    token,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    mode: isPreview ? 'preview' : 'external',
    client: {
      name: access.clientName,
      programName: access.programName,
      campName: access.campName,
      accessId: access.accessId,
      clientMasterId: String(access.clientMasterId),
      features,
    },
    features,
  };
}

/** Staff preview: programme-scoped session without PIN (RBAC enforced by caller). */
export async function mintClientOnePreviewSession(master, actor = {}) {
  if (!master?._id) throw new AppError('Client master is required', 400, 'VALIDATION_ERROR');
  const keys = programmeKeysFromMaster(master);
  if (!keys.clientId || !keys.programName || !keys.campName) {
    throw new AppError(
      'Client Master needs Client, Division / Therapy, and Method before Client One preview',
      400,
      'VALIDATION_ERROR',
    );
  }
  const existing = await findActiveAccessForMaster(master._id);
  const accessLike = {
    accessId: existing?.accessId || `preview:${master._id}`,
    clientMasterId: master._id,
    clientId: keys.clientId,
    clientName: keys.clientName,
    programName: keys.programName,
    campName: keys.campName,
    features: normalizeClientOneFeatures(existing?.features),
    isActive: true,
    revokedAt: null,
  };
  return signClientOneSession(accessLike, { preview: true, actor });
}

export function verifyClientOneSessionToken(raw) {
  const token = String(raw || '').trim();
  if (!token) throw new AppError('Sign in required', 401, 'UNAUTHORIZED');
  let decoded;
  try {
    decoded = jwt.verify(token, env.jwtAccessSecret);
  } catch {
    throw new AppError('Session expired. Enter your PIN again.', 401, 'UNAUTHORIZED');
  }
  if (
    (decoded?.typ !== 'client_one' && decoded?.typ !== 'client_one_preview')
    || !decoded.accessId
  ) {
    throw new AppError('Invalid Client One session', 401, 'UNAUTHORIZED');
  }
  return decoded;
}

export function isClientOnePreviewToken(decoded) {
  return decoded?.typ === 'client_one_preview' || decoded?.mode === 'preview';
}

/** Resolve programme access for either external PIN session or staff preview. */
export async function resolveClientOneSessionAccess(decoded) {
  if (isClientOnePreviewToken(decoded)) {
    const masterId = decoded.clientMasterId;
    if (!masterId) throw new AppError('Invalid Client One preview session', 401, 'UNAUTHORIZED');
    const master = await loadClientMasterOrThrow(masterId);
    if (master.isActive === false) {
      throw new AppError('This programme is inactive', 403, 'ACCESS_INACTIVE');
    }
    const keys = programmeKeysFromMaster(master);
    const existing = await findActiveAccessForMaster(master._id);
    return {
      accessId: existing?.accessId || decoded.accessId || `preview:${master._id}`,
      clientMasterId: master._id,
      clientId: keys.clientId,
      clientName: keys.clientName,
      programName: keys.programName,
      campName: keys.campName,
      features: normalizeClientOneFeatures(existing?.features),
      isActive: true,
      revokedAt: null,
      isPreview: true,
    };
  }

  const access = await getAccessByAccessId(decoded.accessId);
  if (!access || access.isActive === false || access.revokedAt) {
    throw new AppError('Session no longer valid', 401, 'UNAUTHORIZED');
  }
  access.isPreview = false;
  return access;
}

export function toClientOneCampDto(camp) {
  if (!camp) return null;
  const row = typeof camp.toObject === 'function' ? camp.toObject() : { ...camp };
  return {
    _id: row._id,
    campId: row.campId || '',
    campDate: row.campDate || '',
    startTime: row.startTime || '',
    endTime: row.endTime || '',
    campSlot: row.campSlot || '',
    status: row.status || '',
    lifecycleStage: row.lifecycleStage || '',
    requestReviewStatus: row.requestReviewStatus || '',
    assignmentStatus: row.assignmentStatus || '',
    executionStatus: row.executionStatus || row.effectiveExecutionStatus || '',
    effectiveExecutionStatus: row.effectiveExecutionStatus || row.executionStatus || '',
    clientName: row.clientName || '',
    campaignType: row.campaignType || '',
    campaignName: row.campaignName || '',
    campAddress: row.campAddress || '',
    city: row.city || '',
    state: row.state || '',
    pincode: row.pincode || '',
    doctorName: row.doctorName || '',
    hcwName: row.hcwName || '',
    hcwContact: row.hcwContact || '',
    hcwCategory: row.hcwCategory || '',
    contactPersons: Array.isArray(row.contactPersons) ? row.contactPersons : [],
    fieldPersonName: row.fieldPersonName || '',
    fieldPersonPhone: row.fieldPersonPhone || '',
    inTime: row.inTime || '',
    outTime: row.outTime || '',
    chargeableStatus: row.chargeableStatus || '',
    punctuality: row.punctuality || '',
    attire: row.attire || '',
    actualPatients: row.actualPatients ?? null,
    cancellationBy: row.cancellationBy || row.cancelledBy || '',
    isOverdue: Boolean(row.isOverdue),
  };
}

function startOfUtcDay(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function ymd(d) {
  const x = new Date(d);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, '0');
  const day = String(x.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function defaultDashboardWindow(now = new Date()) {
  const end = startOfUtcDay(now);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  return { from: ymd(start), to: ymd(end) };
}

export async function loadScopedCamps(access, { from, to } = {}) {
  const filter = buildCampScopeFilter(access);
  if (from || to) {
    filter.campDate = {};
    if (from) filter.campDate.$gte = String(from).slice(0, 10);
    if (to) filter.campDate.$lte = String(to).slice(0, 10);
  }
  const rows = await CampOpsCamp.find(filter);
  return Array.isArray(rows) ? rows : [];
}

function campPlain(raw) {
  return typeof raw?.toObject === 'function' ? raw.toObject() : raw;
}

function parseIsoDay(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const ms = Date.parse(`${raw}T12:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

function daysBetweenIso(fromValue, toValue) {
  const fromMs = parseIsoDay(fromValue);
  const toMs = parseIsoDay(toValue);
  if (fromMs == null || toMs == null) return null;
  return Math.round((toMs - fromMs) / 86400000);
}

function bumpCount(map, key, by = 1) {
  const label = String(key || '').trim() || 'Unspecified';
  map.set(label, (map.get(label) || 0) + by);
}

function slicesFromCountMap(map, order = []) {
  const total = [...map.values()].reduce((sum, n) => sum + n, 0);
  const keys = order.length
    ? order.filter((k) => map.has(k) || order.includes(k))
    : [...map.keys()].sort((a, b) => (map.get(b) || 0) - (map.get(a) || 0));
  const seen = new Set();
  const rows = [];
  for (const label of keys) {
    if (seen.has(label)) continue;
    seen.add(label);
    const value = map.get(label) || 0;
    if (!order.length && value <= 0) continue;
    rows.push({
      label,
      value,
      pct: total > 0 ? Math.round((value / total) * 1000) / 10 : 0,
    });
  }
  if (order.length) {
    for (const [label, value] of map.entries()) {
      if (seen.has(label) || value <= 0) continue;
      rows.push({
        label,
        value,
        pct: total > 0 ? Math.round((value / total) * 1000) / 10 : 0,
      });
    }
  }
  return { total, slices: rows };
}

/** Final Billing: Camp One chargeability buckets with Pending shown as Planned. */
function classifyFinalBillingBucket(camp = {}) {
  const bucket = classifyChargeabilityBucket(camp.chargeableStatus);
  return bucket === 'Pending' ? 'Planned' : bucket;
}

/** Request lead days: requestDate (fallback submittedAt) → campDate. */
function classifyRequestTimelineBucket(camp = {}) {
  const requestAnchor = camp.requestDate
    || String(camp.submittedAt || '').slice(0, 10)
    || '';
  const leadDays = daysBetweenIso(requestAnchor, camp.campDate);
  if (leadDays == null) return null;
  return leadDays < 5 ? 'Less than 5 Days' : '5 or more Days';
}

/** Extra Hours: Camp One overtime hours, within 4 vs beyond 4. */
function classifyExtraHoursBucket(camp = {}) {
  if (!isCampExecutedForPayout(camp)) return null;
  const derived = computeLifecycleDerived(camp, { pricing: campSnapshotPricing(camp) });
  const extraHours = Number.isFinite(Number(derived.extraHours))
    ? Number(derived.extraHours)
    : Number(camp.extraHours);
  if (!Number.isFinite(extraHours)) return null;
  return extraHours <= 4 ? 'Within 4 Hours' : 'Beyond 4 Hours';
}

function classifyExecutedClinicBucket(camp = {}) {
  const closure = resolveCancelledClosureExecutionStatus(camp);
  if (closure === 'Cancelled by Client') return 'Cancelled by Client';
  if (closure === 'Cancelled by Tylo') return 'Cancelled by Tylo';
  if (isCampExecutedForPayout(camp) || String(camp.status || '').toLowerCase() === 'executed') {
    return 'Executed';
  }
  return null;
}

function resolveTyloCancellationReasonLabel(camp = {}) {
  const code = normalizeClosureSubReason(
    camp.closureSubReason || camp.closureReasonCode || camp.cancellationReason || '',
  );
  const category = String(camp.closureReasonCategory || '').trim();
  if (code && category) {
    const meta = findClosureSubReason('Cancelled by Tylo', category, code);
    if (meta?.label) return meta.label;
  }
  if (code) {
    const tree = CAMP_CLOSURE_TAXONOMY['Cancelled by Tylo'] || {};
    for (const reasons of Object.values(tree)) {
      const match = (reasons || []).find((item) => item.value === code);
      if (match?.label) return match.label;
    }
  }
  const label = String(camp.closureSubReasonLabel || '').trim();
  if (label) return label;
  return 'Unspecified';
}

function resolveMrName(camp = {}) {
  const contacts = Array.isArray(camp.contactPersons) ? camp.contactPersons : [];
  const tm = contacts.find((person) => {
    const level = String(person?.level || person?.role || person?.code || '').toLowerCase();
    return level.includes('territory')
      || level.includes('manager')
      || level === 'tm'
      || level === 'mr'
      || level.includes('tbm');
  });
  return String(tm?.name || camp.fieldPersonName || '').trim();
}

function leaderboardFromMap(map, limit = 3) {
  return [...map.values()]
    .map((row) => ({
      name: row.name,
      state: row.state || '—',
      camps: row.camps,
      patients: row.patients,
      avgPatients: row.camps > 0
        ? Math.round((row.patients / row.camps) * 10) / 10
        : 0,
    }))
    .sort((a, b) => b.patients - a.patients || b.camps - a.camps || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function computeClientOneKpis(camps = [], { from, to, now = new Date() } = {}) {
  const today = ymd(now);
  const in7 = new Date(now);
  in7.setUTCDate(in7.getUTCDate() + 7);
  const until = ymd(in7);

  let total = 0;
  let approved = 0;
  let executed = 0;
  let cancelled = 0;
  let cancelledByClient = 0;
  let cancelledByTylo = 0;
  let pending = 0;
  let upcoming = 0;
  let chargeable = 0;
  let nonChargeable = 0;
  let eligibleExecuted = 0;
  let patientsScreened = 0;
  const doctorNames = new Set();

  for (const raw of camps) {
    const camp = campPlain(raw);
    total += 1;
    const status = String(camp.status || '').toLowerCase();
    const date = String(camp.campDate || '').slice(0, 10);
    const patients = Number(camp.actualPatients ?? camp.patientsCount);
    if (Number.isFinite(patients) && patients > 0) patientsScreened += patients;
    const doctor = String(camp.doctorName || '').trim();
    if (doctor) doctorNames.add(doctor.toLowerCase());

    const clinicBucket = classifyExecutedClinicBucket(camp);
    if (clinicBucket === 'Executed' || status === 'executed') {
      executed += 1;
      eligibleExecuted += 1;
    } else if (clinicBucket === 'Cancelled by Client') {
      cancelled += 1;
      cancelledByClient += 1;
    } else if (clinicBucket === 'Cancelled by Tylo') {
      cancelled += 1;
      cancelledByTylo += 1;
    } else if (status === 'cancelled' || status === 'rejected') {
      cancelled += 1;
    } else if (status === 'approved') {
      approved += 1;
      if (date && date >= today) eligibleExecuted += 1;
    } else if (status === 'pending_review' || !status) {
      pending += 1;
    } else {
      pending += 1;
    }

    if (date && date >= today && date <= until && status !== 'cancelled' && status !== 'rejected') {
      upcoming += 1;
    }

    const billing = classifyFinalBillingBucket(camp);
    if (billing === 'Chargeable') chargeable += 1;
    else if (billing === 'Non-Chargeable') nonChargeable += 1;
  }

  const completionRate = eligibleExecuted > 0
    ? Math.round((executed / eligibleExecuted) * 1000) / 10
    : null;

  return {
    from: from || null,
    to: to || null,
    total,
    campCount: total,
    patientsScreened,
    uniqueDoctors: doctorNames.size,
    approved,
    executed,
    cancelled,
    cancelledByClient,
    cancelledByTylo,
    pending,
    upcoming7Days: upcoming,
    executionCompletionPct: completionRate,
    chargeable,
    nonChargeable,
  };
}

/**
 * Client One dashboard charts + leaderboards.
 * Buckets reuse Camp One classifiers / closure taxonomy — no parallel status model.
 */
export function computeClientOneDashboardAnalytics(camps = []) {
  const requestMap = new Map();
  const billingMap = new Map();
  const punctualityMap = new Map();
  const extraHoursMap = new Map();
  const executedMap = new Map();
  const tyloCancelReasonMap = new Map();
  const doctorMap = new Map();
  const mrMap = new Map();

  for (const raw of camps) {
    const camp = campPlain(raw) || {};
    const patients = Number(camp.actualPatients ?? camp.patientsCount);
    const patientCount = Number.isFinite(patients) && patients > 0 ? patients : 0;
    const state = String(camp.state || '').trim();

    const requestBucket = classifyRequestTimelineBucket(camp);
    if (requestBucket) bumpCount(requestMap, requestBucket);

    bumpCount(billingMap, classifyFinalBillingBucket(camp));
    bumpCount(punctualityMap, classifyPunctualityBucket(camp));

    const extraBucket = classifyExtraHoursBucket(camp);
    if (extraBucket) bumpCount(extraHoursMap, extraBucket);

    const clinicBucket = classifyExecutedClinicBucket(camp);
    if (clinicBucket) {
      bumpCount(executedMap, clinicBucket);
      if (clinicBucket === 'Cancelled by Tylo') {
        bumpCount(tyloCancelReasonMap, resolveTyloCancellationReasonLabel(camp));
      }
    }

    const doctor = String(camp.doctorName || '').trim();
    if (doctor) {
      const key = doctor.toLowerCase();
      const row = doctorMap.get(key) || { name: doctor, state: '', camps: 0, patients: 0 };
      row.camps += 1;
      row.patients += patientCount;
      if (!row.state && state) row.state = state;
      doctorMap.set(key, row);
    }

    const mr = resolveMrName(camp);
    if (mr) {
      const key = mr.toLowerCase();
      const row = mrMap.get(key) || { name: mr, state: '', camps: 0, patients: 0 };
      row.camps += 1;
      row.patients += patientCount;
      if (!row.state && state) row.state = state;
      mrMap.set(key, row);
    }
  }

  return {
    charts: {
      requestTimeline: slicesFromCountMap(requestMap, ['Less than 5 Days', '5 or more Days']),
      finalBilling: slicesFromCountMap(billingMap, ['Chargeable', 'Non-Chargeable', 'Planned']),
      punctuality: slicesFromCountMap(punctualityMap, [
        'Pending',
        'Cancelled',
        'Good',
        'Average',
        'Poor',
      ]),
      extraHours: slicesFromCountMap(extraHoursMap, ['Within 4 Hours', 'Beyond 4 Hours']),
      executedClinics: slicesFromCountMap(executedMap, [
        'Executed',
        'Cancelled by Client',
        'Cancelled by Tylo',
      ]),
      tyloCancellation: slicesFromCountMap(tyloCancelReasonMap),
    },
    leaderboards: {
      doctors: leaderboardFromMap(doctorMap, 3),
      mrs: leaderboardFromMap(mrMap, 3),
    },
  };
}

export async function loadClientMasterOrThrow(id) {
  const row = await CampOpsClientMaster.findOne({ _id: id, isDeleted: false });
  if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
  return row;
}
