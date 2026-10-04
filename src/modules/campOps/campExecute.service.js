import { createHash, randomBytes } from 'crypto';
import { AppError } from '../../utils/helpers.js';
import { env } from '../../config/env.js';
import { assignPreservingExisting } from '../../store/dataIntegrity.js';
import {
  CampOpsCamp,
  CampOpsExecutionInvite,
} from './campOps.model.js';
import {
  EXECUTION_DOC_TYPES,
  isAssignedForExecutionAdvance,
  normalizeExecutionDocType,
} from './campOps.lifecycle.js';
import { getCampStartDateTime } from './campOps.helpers.js';
import {
  getConsumablesCompletionBlockers,
  normalizeConsumablesUsed,
} from './campConsumables.js';
import { resolveMappedConsumablesForCamp } from './clientMasterConsumables.js';

export const EXECUTOR_GPS_RADIUS_M = 250;
/** Activity Form links auto-disable this many hours after camp start time. */
export const EXECUTION_INVITE_HOURS_AFTER_START = 72;

/** Unambiguous URL-safe alphabet for short Activity Form links (~59 bits at length 10). */
const SHORT_TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export const EXECUTION_INVITE_TOKEN_LENGTH = 10;

export function hashExecutionToken(raw) {
  const token = String(raw || '');
  if (!token || token.length > 512) return null;
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Short public invite token for /e/:token share links.
 * Stored only as SHA-256 hash; old long base64url tokens remain valid.
 */
export function mintExecutionToken(length = EXECUTION_INVITE_TOKEN_LENGTH) {
  const size = Math.max(6, Math.min(32, Number(length) || EXECUTION_INVITE_TOKEN_LENGTH));
  const bytes = randomBytes(size);
  let token = '';
  for (let i = 0; i < size; i += 1) {
    token += SHORT_TOKEN_ALPHABET[bytes[i] % SHORT_TOKEN_ALPHABET.length];
  }
  return token;
}

/** Haversine distance in meters. */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const r = 6371000;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(Number(lat2) - Number(lat1));
  const Δλ = toRad(Number(lng2) - Number(lng1));
  const a = Math.sin(Δφ / 2) ** 2
    + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function evaluateGpsAgainstCamp(camp, { latitude, longitude, accuracy } = {}) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new AppError('GPS coordinates are required for the selfie', 400, 'VALIDATION_ERROR');
  }
  const rawCampLat = camp?.latitude;
  const rawCampLng = camp?.longitude;
  const campLat = Number(rawCampLat);
  const campLng = Number(rawCampLng);
  const hasCampCoords = rawCampLat !== null && rawCampLat !== undefined && rawCampLat !== ''
    && rawCampLng !== null && rawCampLng !== undefined && rawCampLng !== ''
    && Number.isFinite(campLat) && Number.isFinite(campLng);
  let distance = null;
  let withinRadius = null;
  if (hasCampCoords) {
    distance = Math.round(distanceMeters(campLat, campLng, lat, lng));
    withinRadius = distance <= EXECUTOR_GPS_RADIUS_M;
  }
  return {
    latitude: lat,
    longitude: lng,
    accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
    withinRadius,
    distanceMeters: distance,
    capturedAt: new Date().toISOString(),
    campHasCoordinates: hasCampCoords,
    radiusMeters: EXECUTOR_GPS_RADIUS_M,
  };
}

function clinicLabel(camp) {
  const name = String(camp.clinicName || camp.hospitalName || '').trim();
  const address = String(camp.campAddress || '').trim();
  if (name && address) return `${name}, ${address}`;
  return name || address || '';
}

function formatCampDateLabel(isoDate) {
  const raw = String(isoDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    weekday: 'long',
  });
}

function docsByType(docs = []) {
  const list = Array.isArray(docs) ? docs : [];
  const has = (type) => list.some((d) => normalizeExecutionDocType(d?.docType) === type);
  return {
    doctor_form: has('doctor_form'),
    patient_form: has('patient_form'),
    gps_selfie: has('gps_selfie'),
  };
}

export function publicExecutionContext(invite, camp, mappedConsumables = []) {
  const docs = Array.isArray(camp.executionDocuments) ? camp.executionDocuments : [];
  const required = docsByType(docs);
  const locked = invite.status === 'SUBMITTED'
    || String(camp.executorFormStatus || '') === 'submitted';
  return {
    invite: {
      status: invite.status,
      expiresAt: invite.expiresAt,
      submittedAt: invite.submittedAt || camp.executorSubmittedAt || null,
      locked,
    },
    camp: {
      campId: camp.campId,
      campDate: camp.campDate,
      campDateLabel: formatCampDateLabel(camp.campDate),
      doctorName: camp.doctorName || '',
      clinicName: camp.clinicName || camp.hospitalName || '',
      clinicAddress: camp.campAddress || '',
      clinicLabel: clinicLabel(camp),
      lifecycleStage: camp.lifecycleStage,
      latitude: camp.latitude ?? null,
      longitude: camp.longitude ?? null,
    },
    form: {
      inTime: camp.inTime || '',
      outTime: camp.outTime || '',
      patientsScreened: camp.actualPatients ?? camp.patientsCount ?? '',
      productCount: camp.rxCount ?? '',
      consumablesUsed: Array.isArray(camp.consumablesUsed) ? camp.consumablesUsed : [],
      executorFormStatus: camp.executorFormStatus || (locked ? 'submitted' : 'draft'),
      executorGps: camp.executorGps || null,
    },
    documents: docs.map((doc) => ({
      fileId: doc.fileId || doc._id || doc.storedName || doc.url,
      docType: normalizeExecutionDocType(doc.docType),
      fileName: doc.fileName || doc.storedName || 'Document',
      url: doc.url || '',
      size: doc.size || null,
    })),
    documentStatus: {
      doctor_form: required.doctor_form ? 'uploaded' : 'required',
      patient_form: required.patient_form ? 'uploaded' : 'required',
      gps_selfie: required.gps_selfie ? 'uploaded' : 'required',
    },
    consumableOptions: (mappedConsumables || []).map((item) => ({
      productId: item.productId,
      itemName: item.itemName || '',
      unit: item.unit || '',
      uomId: item.uomId || '',
    })),
    gps: {
      radiusMeters: EXECUTOR_GPS_RADIUS_M,
      campHasCoordinates: camp.latitude !== null && camp.latitude !== undefined && camp.latitude !== ''
        && camp.longitude !== null && camp.longitude !== undefined && camp.longitude !== ''
        && Number.isFinite(Number(camp.latitude))
        && Number.isFinite(Number(camp.longitude)),
    },
  };
}

/**
 * Link expiry = camp start datetime + 72 hours.
 * @returns {Date|null}
 */
export function resolveExecutionInviteExpiresAt(camp, now = new Date()) {
  const start = getCampStartDateTime(camp);
  if (!start) return null;
  return new Date(start.getTime() + EXECUTION_INVITE_HOURS_AFTER_START * 60 * 60 * 1000);
}

export function isExecutionInviteExpiredForCamp(camp, now = new Date()) {
  const expiresAt = resolveExecutionInviteExpiresAt(camp, now);
  if (!expiresAt) return false;
  return expiresAt.getTime() <= now.getTime();
}

async function revokeExpiredInvite(invite) {
  if (!invite || invite.status !== 'PENDING') return invite;
  invite.status = 'REVOKED';
  invite.revokedAt = new Date().toISOString();
  await invite.save();
  return invite;
}

export async function resolveExecutionInvite(rawToken) {
  const tokenHash = hashExecutionToken(rawToken);
  const invite = tokenHash
    ? await CampOpsExecutionInvite.findOne({ tokenHash })
    : null;
  if (!invite) throw new AppError('Invalid execution link', 404, 'LINK_INVALID');

  const camp = await CampOpsCamp.findOne({
    _id: invite.campRefId,
    isDeleted: false,
  });
  if (!camp) throw new AppError('Camp not found', 404, 'NOT_FOUND');

  const now = Date.now();
  const campExpiresAt = resolveExecutionInviteExpiresAt(camp);
  const inviteExpired = Boolean(
    invite.expiresAt && new Date(invite.expiresAt).getTime() <= now,
  );
  const campWindowExpired = Boolean(
    campExpiresAt && campExpiresAt.getTime() <= now,
  );

  if (invite.status === 'PENDING' && (inviteExpired || campWindowExpired)) {
    await revokeExpiredInvite(invite);
    throw new AppError(
      'This execution link expired 72 hours after the camp start time',
      410,
      'LINK_EXPIRED',
    );
  }

  if (invite.status === 'REVOKED') {
    throw new AppError('This execution link is no longer active', 410, 'LINK_REVOKED');
  }

  return { invite, camp };
}

export async function loadMappedConsumables(camp) {
  if (!camp?.clientId) return [];
  try {
    return await resolveMappedConsumablesForCamp(camp.clientId, {
      campaignType: camp.campaignType,
      campaignName: camp.campaignName,
    });
  } catch {
    return [];
  }
}

export async function assertInviteEditable(invite, camp) {
  if (invite.status === 'SUBMITTED' || String(camp.executorFormStatus || '') === 'submitted') {
    throw new AppError('Execution form already submitted', 409, 'LINK_SUBMITTED');
  }
  if (invite.status !== 'PENDING') {
    throw new AppError('This execution link is no longer active', 410, 'LINK_REVOKED');
  }
  if (isExecutionInviteExpiredForCamp(camp)) {
    throw new AppError(
      'This execution link expired 72 hours after the camp start time',
      410,
      'LINK_EXPIRED',
    );
  }
}

export function applyExecutorDraft(camp, body = {}) {
  const patch = {};
  if (body.inTime !== undefined) patch.inTime = String(body.inTime || '').trim();
  if (body.outTime !== undefined) patch.outTime = String(body.outTime || '').trim();
  if (body.patientsScreened !== undefined || body.actualPatients !== undefined || body.patientsCount !== undefined) {
    const raw = body.patientsScreened ?? body.actualPatients ?? body.patientsCount;
    const n = Number(raw);
    patch.actualPatients = Number.isFinite(n) ? Math.max(0, n) : 0;
    patch.patientsCount = patch.actualPatients;
  }
  if (body.productCount !== undefined || body.rxCount !== undefined) {
    const n = Number(body.productCount ?? body.rxCount);
    patch.rxCount = Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  if (body.consumablesUsed !== undefined) {
    patch.consumablesUsed = normalizeConsumablesUsed(body.consumablesUsed);
  }
  if (body.executorGps && typeof body.executorGps === 'object') {
    patch.executorGps = evaluateGpsAgainstCamp(camp, body.executorGps);
  }
  if (!camp.executorFormStatus || camp.executorFormStatus === '') {
    patch.executorFormStatus = 'draft';
  }
  assignPreservingExisting(camp, patch);
  return camp;
}

function hasNonNegativeNumber(value) {
  if (value === null || value === undefined || value === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

export function executorSubmitBlockers(camp, mappedConsumables = []) {
  const blockers = [];
  if (!String(camp.inTime || '').trim()) blockers.push('Enter In Time');
  if (!String(camp.outTime || '').trim()) blockers.push('Enter Out Time');
  if (!hasNonNegativeNumber(camp.actualPatients) && !hasNonNegativeNumber(camp.patientsCount)) {
    blockers.push('Enter Patients Screened');
  }
  if (!hasNonNegativeNumber(camp.rxCount)) {
    blockers.push('Enter Product Count');
  }
  const docs = Array.isArray(camp.executionDocuments) ? camp.executionDocuments : [];
  const types = docsByType(docs);
  if (!types.doctor_form) blockers.push('Upload Doctor Form (DF)');
  if (!types.patient_form) blockers.push('Upload Patient Form (PF)');
  if (!types.gps_selfie) blockers.push('Capture GPS Selfie (GS)');

  const gps = camp.executorGps || {};
  const campHasCoords = camp.latitude !== null && camp.latitude !== undefined && camp.latitude !== ''
    && camp.longitude !== null && camp.longitude !== undefined && camp.longitude !== ''
    && Number.isFinite(Number(camp.latitude))
    && Number.isFinite(Number(camp.longitude));
  if (!Number.isFinite(Number(gps.latitude)) || !Number.isFinite(Number(gps.longitude))) {
    blockers.push('Capture GPS location with the selfie');
  } else if (campHasCoords && gps.withinRadius === false) {
    blockers.push(`Move within ${EXECUTOR_GPS_RADIUS_M} m of the clinic to submit`);
  }

  blockers.push(...getConsumablesCompletionBlockers(mappedConsumables, camp.consumablesUsed));
  // Deduplicate
  return [...new Set(blockers)];
}

/** Match client Copy-details visibility: Assigned status or assign + HCW. */
function isAssignedForActivityLink(camp = {}) {
  if (isAssignedForExecutionAdvance(camp)) return true;
  const status = String(camp?.assignmentStatus || '').trim();
  if (status === 'Assigned') return true;
  const stage = String(camp?.lifecycleStage || '').trim();
  const hasHcw = Boolean(
    String(camp?.hcwContactId || '').trim() || String(camp?.hcwName || '').trim(),
  );
  if (stage === 'execution' && hasHcw) return true;
  return String(camp?.assignmentDecision || '').trim() === 'assign' && hasHcw;
}

/** Activity Form / executor link may be minted once HCW is assigned (for Copy details). */
export function canMintExecutionActivityLink(camp = {}) {
  const status = String(camp?.status || '').trim();
  if (['cancelled', 'rejected'].includes(status)) return false;
  if (!['approved', 'executed'].includes(status)) return false;
  if (String(camp?.executorFormStatus || '').trim() === 'submitted') return false;
  if (!isAssignedForActivityLink(camp)) return false;
  if (isExecutionInviteExpiredForCamp(camp)) return false;
  return true;
}

export async function createOrRefreshExecutionInvite(camp, actor = {}) {
  const expiresAt = resolveExecutionInviteExpiresAt(camp);
  if (!expiresAt) {
    throw new AppError('Camp date and start time are required for an Activity Form link', 400, 'VALIDATION_ERROR');
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new AppError(
      'Activity Form link is disabled — more than 72 hours after camp start',
      410,
      'LINK_EXPIRED',
    );
  }

  const existing = await CampOpsExecutionInvite.findOne({
    campRefId: camp._id,
    status: 'PENDING',
  });
  if (existing) {
    // Cannot recover raw token — mint a fresh one and revoke old.
    existing.status = 'REVOKED';
    existing.revokedAt = new Date().toISOString();
    await existing.save();
  }

  let token = '';
  let invite = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    token = mintExecutionToken();
    const tokenHash = hashExecutionToken(token);
    const existingHash = await CampOpsExecutionInvite.findOne({ tokenHash });
    if (existingHash) continue;
    invite = await CampOpsExecutionInvite.create({
      campRefId: camp._id,
      campId: camp.campId || '',
      tokenHash,
      status: 'PENDING',
      expiresAt: expiresAt.toISOString(),
      createdById: actor.id || actor._id || null,
      createdByEmail: actor.email || '',
    });
    break;
  }
  if (!invite || !token) {
    throw new AppError('Could not create Activity Form link', 500, 'LINK_MINT_FAILED');
  }

  // Prefer short /e/:token for WhatsApp/share copy; /camp-execute/:token still works.
  const path = `/e/${token}`;
  const origin = String(env.clientOrigin || '').replace(/\/$/, '');
  const url = origin ? `${origin}${path}` : path;
  return { invite, token, url, path, expiresAt: invite.expiresAt };
}

export { EXECUTION_DOC_TYPES };
