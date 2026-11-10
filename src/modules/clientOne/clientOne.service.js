import { createHash, randomBytes, randomInt } from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/helpers.js';
import { CampOpsCamp, CampOpsClientMaster } from '../campOps/campOps.model.js';
import { normalizeCampName } from '../campOps/campOps.constants.js';
import { ClientOneAccess } from './clientOne.model.js';
import { normalizeClientOneFeatures } from './clientOne.features.js';

const PIN_LENGTH = 8;
const SESSION_TTL = '12h';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILED = 8;
const LOCK_MS = 15 * 60 * 1000;
const ACCESS_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function hashClientOnePin(raw) {
  const pin = String(raw || '').trim();
  if (!pin || pin.length > 64) return null;
  return createHash('sha256').update(`client-one:${pin}`).digest('hex');
}

export function mintClientOnePin(length = PIN_LENGTH) {
  const size = Math.max(6, Math.min(12, Number(length) || PIN_LENGTH));
  let pin = '';
  for (let i = 0; i < size; i += 1) {
    pin += String(randomInt(0, 10));
  }
  return pin;
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

export async function mintOrRotateClientOneAccess(master, actor = {}, { rotate = false } = {}) {
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

  let pin = mintClientOnePin();
  let pinHash = hashClientOnePin(pin);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const clash = await ClientOneAccess.findOne({ pinHash, isActive: true, revokedAt: null });
    if (!clash || (existing && String(clash._id) === String(existing._id))) break;
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

  for (const raw of camps) {
    const camp = typeof raw.toObject === 'function' ? raw.toObject() : raw;
    total += 1;
    const status = String(camp.status || '').toLowerCase();
    const date = String(camp.campDate || '').slice(0, 10);
    if (status === 'executed') {
      executed += 1;
      eligibleExecuted += 1;
    } else if (status === 'cancelled' || status === 'rejected') {
      cancelled += 1;
      const by = String(camp.cancellationBy || camp.cancelledBy || '').toLowerCase();
      if (by.includes('client')) cancelledByClient += 1;
      else if (by.includes('tylo') || by.includes('internal')) cancelledByTylo += 1;
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

    const charge = String(camp.chargeableStatus || '').toLowerCase();
    if (charge === 'chargeable' || charge === 'yes') chargeable += 1;
    else if (charge === 'non_chargeable' || charge === 'non-chargeable' || charge === 'no') {
      nonChargeable += 1;
    }
  }

  const completionRate = eligibleExecuted > 0
    ? Math.round((executed / eligibleExecuted) * 1000) / 10
    : null;

  return {
    from: from || null,
    to: to || null,
    total,
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

export async function loadClientMasterOrThrow(id) {
  const row = await CampOpsClientMaster.findOne({ _id: id, isDeleted: false });
  if (!row) throw new AppError('Client master not found', 404, 'NOT_FOUND');
  return row;
}
