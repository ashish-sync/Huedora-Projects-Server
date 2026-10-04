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
  normalizeExecutionDocType,
} from './campOps.lifecycle.js';
import {
  getConsumablesCompletionBlockers,
  normalizeConsumablesUsed,
} from './campConsumables.js';
import { resolveMappedConsumablesForCamp } from './clientMasterConsumables.js';

export const EXECUTOR_GPS_RADIUS_M = 250;
export const EXECUTION_INVITE_TTL_DAYS = 14;

export function hashExecutionToken(raw) {
  const token = String(raw || '');
  if (!token || token.length > 512) return null;
  return createHash('sha256').update(token).digest('hex');
}

export function mintExecutionToken() {
  return randomBytes(32).toString('base64url');
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

export async function resolveExecutionInvite(rawToken) {
  const tokenHash = hashExecutionToken(rawToken);
  const invite = tokenHash
    ? await CampOpsExecutionInvite.findOne({ tokenHash })
    : null;
  if (!invite) throw new AppError('Invalid execution link', 404, 'LINK_INVALID');

  if (
    invite.status === 'PENDING'
    && invite.expiresAt
    && new Date(invite.expiresAt).getTime() <= Date.now()
  ) {
    invite.status = 'REVOKED';
    invite.revokedAt = new Date().toISOString();
    await invite.save();
    throw new AppError('This execution link has expired', 410, 'LINK_EXPIRED');
  }

  if (invite.status === 'REVOKED') {
    throw new AppError('This execution link is no longer active', 410, 'LINK_REVOKED');
  }

  const camp = await CampOpsCamp.findOne({
    _id: invite.campRefId,
    isDeleted: false,
  });
  if (!camp) throw new AppError('Camp not found', 404, 'NOT_FOUND');

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
  if (!types.gps_selfie) blockers.push('Upload GPS Selfie (GS)');

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

export async function createOrRefreshExecutionInvite(camp, actor = {}) {
  const existing = await CampOpsExecutionInvite.findOne({
    campRefId: camp._id,
    status: 'PENDING',
  });
  if (existing?.expiresAt && new Date(existing.expiresAt).getTime() > Date.now()) {
    // Cannot recover raw token — mint a fresh one and revoke old.
    existing.status = 'REVOKED';
    existing.revokedAt = new Date().toISOString();
    await existing.save();
  } else if (existing) {
    existing.status = 'REVOKED';
    existing.revokedAt = new Date().toISOString();
    await existing.save();
  }

  const token = mintExecutionToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + EXECUTION_INVITE_TTL_DAYS);

  const invite = await CampOpsExecutionInvite.create({
    campRefId: camp._id,
    campId: camp.campId || '',
    tokenHash: hashExecutionToken(token),
    status: 'PENDING',
    expiresAt: expiresAt.toISOString(),
    createdById: actor.id || actor._id || null,
    createdByEmail: actor.email || '',
  });

  const path = `/camp-execute/${token}`;
  const url = `${String(env.clientOrigin || '').replace(/\/$/, '')}${path}`;
  return { invite, token, url, path, expiresAt: invite.expiresAt };
}

export { EXECUTION_DOC_TYPES };
