/**
 * Hiring Request progress + threaded updates helpers.
 */

import { randomBytes } from 'crypto';
import {
  HIRING_PROGRESS,
  HIRING_UPDATE_KINDS,
} from './assetRequest.model.js';

export function newHiringUpdateId() {
  return randomBytes(12).toString('hex');
}

export function normalizeHiringProgress(raw) {
  const value = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
  if (HIRING_PROGRESS.includes(value)) return value;
  const aliases = {
    OPEN: 'OPEN',
    REQUESTED: 'OPEN',
    'IN PROGRESS': 'IN_PROGRESS',
    INPROGRESS: 'IN_PROGRESS',
    ACCEPTED: 'IN_PROGRESS',
    ACCEPT: 'IN_PROGRESS',
    AWAITING: 'AWAITING_INFO',
    AWAITING_CLARIFICATION: 'AWAITING_INFO',
    AWAITING_INFO: 'AWAITING_INFO',
    CLARIFICATION: 'AWAITING_INFO',
    INFO: 'AWAITING_INFO',
    SHORTLIST: 'SHORTLISTING',
    HOLD: 'ON_HOLD',
    ONHOLD: 'ON_HOLD',
    DONE: 'FULFILLED',
    COMPLETED: 'FULFILLED',
    CLOSED: 'FULFILLED',
    ASSIGNED: 'FULFILLED',
  };
  return aliases[value] || aliases[String(raw || '').trim().toUpperCase()] || '';
}

export function normalizeHiringUpdateKind(raw) {
  const value = String(raw || '')
    .trim()
    .toUpperCase();
  return HIRING_UPDATE_KINDS.includes(value) ? value : '';
}

export function hiringUpdatesOf(row) {
  return Array.isArray(row?.hiringUpdates) ? row.hiringUpdates : [];
}

export function hasOpenClarification(row) {
  return hiringUpdatesOf(row).some(
    (entry) => entry?.kind === 'CLARIFICATION' && entry?.requiresReply && !entry?.resolvedAt
  );
}

export function canCreatorEditHiringDetails(row) {
  if (!row || row.requestType !== 'HIRING') return false;
  if (!['REQUESTED', 'APPROVED'].includes(row.status)) return false;
  if (String(row.hiringProgress || '').toUpperCase() === 'AWAITING_INFO') return true;
  return hasOpenClarification(row);
}

export function buildHiringUpdateEntry({
  kind,
  message,
  actor,
  progress = null,
  requiresReply = false,
} = {}) {
  const actorId = actor?._id || actor?.id || null;
  return {
    id: newHiringUpdateId(),
    at: new Date().toISOString(),
    actorId,
    actorName: String(actor?.fullName || actor?.email || 'User').trim() || 'User',
    kind,
    message: String(message || '').trim(),
    progress: progress || null,
    requiresReply: Boolean(requiresReply),
    resolvedAt: null,
    resolvedById: null,
  };
}

export function resolveOpenClarifications(updates, actorId, at = new Date().toISOString()) {
  return (updates || []).map((entry) => {
    if (entry?.kind !== 'CLARIFICATION' || !entry?.requiresReply || entry?.resolvedAt) {
      return entry;
    }
    return {
      ...entry,
      resolvedAt: at,
      resolvedById: actorId || null,
    };
  });
}

/** Fields a requestor may patch while clarification is open. */
export const HIRING_DETAIL_PATCH_FIELDS = [
  'reason',
  'hiringType',
  'hcwType',
  'campType',
  'hiringMethod',
  'engagementDateTime',
  'hiringAddress',
  'hiringState',
  'hiringCity',
  'hiringName',
  'hiringPinCode',
  'budgetMin',
  'budgetMax',
];

export function pickHiringDetailPatch(body = {}) {
  const patch = {};
  for (const key of HIRING_DETAIL_PATCH_FIELDS) {
    if (body[key] === undefined) continue;
    if (key === 'budgetMin' || key === 'budgetMax') {
      const raw = body[key];
      if (raw === '' || raw == null) patch[key] = null;
      else {
        const n = Number(raw);
        if (Number.isFinite(n)) patch[key] = n;
      }
      continue;
    }
    patch[key] = String(body[key] ?? '').trim();
  }
  return patch;
}
