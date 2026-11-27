/**
 * Gated historical rehydrate from verified audit snapshots.
 * Never mints replacement IDs. Never fabricates business fields.
 * Default dry-run; apply requires TYLO_CAMP_REHYDRATE=1.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { queryCollection, upsertDocument } from '../../store/persistence.js';
import { uploadDir } from '../../config/paths.js';
import { writeAudit } from '../../utils/audit.js';
import { CampOpsCamp } from './campOps.model.js';
import { initializeAllCampIdCounters } from './campIdSequence.js';
import {
  buildCampRecoveryInventory,
  FULL_SNAPSHOT_KEY_THRESHOLD,
} from './campRecoveryInventory.js';
import { archiveCampRecord } from './campLifecycle.js';

export const REHYDRATE_MANIFEST_COLLECTION = 'camp_ops_rehydrate_manifests';

const ALLOWED_FROM_SNAPSHOT = null; // use all snapshot keys present; schema fills defaults on create

function snapshotKeyCount(snap) {
  if (!snap || typeof snap !== 'object') return 0;
  return Object.keys(snap).length;
}

function pickBestSnapshotFromAudits(audits = []) {
  let best = null;
  let bestCount = 0;
  let bestAuditId = null;
  for (const row of audits) {
    for (const snap of [row.after, row.before]) {
      const count = snapshotKeyCount(snap);
      if (count > bestCount) {
        bestCount = count;
        best = snap;
        bestAuditId = row._id;
      }
    }
  }
  return { snapshot: best, keyCount: bestCount, auditId: bestAuditId };
}

async function loadAuditsForEntity(entityId, campId) {
  const { data } = await queryCollection('audit_logs', {
    filter: {},
    projection: {
      _id: 1,
      action: 1,
      entityId: 1,
      before: 1,
      after: 1,
      at: 1,
      createdAt: 1,
    },
  });
  return (data || []).filter((row) => {
    const eid = String(row.entityId || '');
    const cid = String(row.after?.campId || row.before?.campId || '');
    if (entityId && eid === String(entityId)) return true;
    if (campId && cid === String(campId)) return true;
    return false;
  });
}

function listUploadsForCampId(campId) {
  try {
    const dir = uploadDir('camp-ops');
    if (!fs.existsSync(dir)) return [];
    const prefix = `${campId}__`;
    return fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({
        storedName: name,
        url: `/uploads/camp-ops/${name}`,
        fileName: name,
        originalFileName: name,
      }));
  } catch {
    return [];
  }
}

function buildDocFromSnapshot(snapshot, uploads = []) {
  const doc = { ...snapshot };
  // Never invent — only reattach files when snapshot lacks docs but orphans exist.
  if (
    (!Array.isArray(doc.executionDocuments) || !doc.executionDocuments.length) &&
    uploads.length
  ) {
    doc.executionDocuments = uploads.map((u, idx) => ({
      id: `rehydrated-${idx}`,
      fileName: u.fileName,
      storedName: u.storedName,
      originalFileName: u.originalFileName,
      url: u.url,
      storageStatus: 'local',
      uploadedAt: doc.updatedAt || doc.createdAt || new Date().toISOString(),
      docType: 'Recovered',
    }));
  }
  doc.isDeleted = false;
  doc.deletedAt = null;
  doc.deletedBy = null;
  doc.rehydratedAt = new Date().toISOString();
  doc.rehydratedFromAudit = true;
  return doc;
}

/**
 * Plan or apply rehydrate for inventory class rehydrate_free_id (and optional explicit ids).
 */
export async function rehydrateHistoricalCamps({
  dryRun = true,
  apply = false,
  actorId = 'script:camp-rehydrate',
  campIds = null,
} = {}) {
  const envOk = String(process.env.TYLO_CAMP_REHYDRATE || '') === '1';
  const shouldApply = Boolean(apply) && envOk && !dryRun;

  const inventory = await buildCampRecoveryInventory();
  let candidates = (inventory.missing || []).filter((m) => m.feasibility === 'rehydrate_free_id');
  if (Array.isArray(campIds) && campIds.length) {
    const want = new Set(campIds.map((c) => String(c)));
    candidates = candidates.filter((m) => want.has(String(m.campId)));
  }
  // Dedupe by original entity id (fallback campId) — inventory may list audit + upload sources.
  const seen = new Set();
  candidates = candidates.filter((m) => {
    const key = String(m._id || m.campId || '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const changes = [];
  const insertedIds = [];

  for (const candidate of candidates) {
    const audits = await loadAuditsForEntity(candidate._id, candidate.campId);
    const { snapshot, keyCount, auditId } = pickBestSnapshotFromAudits(audits);
    if (!snapshot || keyCount < FULL_SNAPSHOT_KEY_THRESHOLD) {
      changes.push({
        campId: candidate.campId,
        _id: candidate._id,
        ok: false,
        skipped: true,
        reason: 'incomplete_snapshot',
        keyCount,
      });
      continue;
    }

    const originalId = String(snapshot._id || candidate._id || '').trim();
    const originalCampId = String(snapshot.campId || candidate.campId || '').trim();
    if (!originalId || !originalCampId) {
      changes.push({
        campId: originalCampId,
        _id: originalId,
        ok: false,
        skipped: true,
        reason: 'missing_identity',
      });
      continue;
    }

    const existingById = await CampOpsCamp.findOne({ _id: originalId });
    const existingByCampId = await CampOpsCamp.findOne({ campId: originalCampId });
    if (existingById || existingByCampId) {
      changes.push({
        campId: originalCampId,
        _id: originalId,
        ok: false,
        skipped: true,
        reason: 'already_present',
        existingId: existingById?._id || existingByCampId?._id,
      });
      continue;
    }

    const uploads = listUploadsForCampId(originalCampId);
    const doc = buildDocFromSnapshot(snapshot, uploads);
    doc._id = originalId;
    doc.campId = originalCampId;

    if (!shouldApply) {
      changes.push({
        campId: originalCampId,
        _id: originalId,
        ok: true,
        applied: false,
        dryRun: true,
        auditId,
        keyCount,
        uploadCount: uploads.length,
      });
      continue;
    }

    await CampOpsCamp.create(doc);
    insertedIds.push(originalId);
    try {
      await writeAudit({
        actorId,
        actorType: 'SYSTEM',
        action: 'camp_ops.camp_rehydrate',
        entityType: 'camp_ops_camp',
        entityId: originalId,
        before: null,
        after: { campId: originalCampId, _id: originalId, rehydratedFromAudit: true },
        reason: `Rehydrate from audit ${auditId || 'unknown'}`,
        message: `Rehydrated camp ${originalCampId}`,
      });
    } catch {
      /* audit must not block */
    }
    changes.push({
      campId: originalCampId,
      _id: originalId,
      ok: true,
      applied: true,
      auditId,
      keyCount,
      uploadCount: uploads.length,
    });
  }

  let counters = [];
  let manifestId = null;
  if (shouldApply && insertedIds.length) {
    counters = await initializeAllCampIdCounters();
    manifestId = randomUUID();
    await upsertDocument(REHYDRATE_MANIFEST_COLLECTION, {
      _id: manifestId,
      manifestId,
      createdAt: new Date().toISOString(),
      actorId,
      insertedIds,
      changes: changes.filter((c) => c.applied),
      rolledBackAt: null,
    });
  }

  return {
    dryRun: !shouldApply,
    envGate: envOk,
    applied: shouldApply,
    candidateCount: candidates.length,
    changes,
    insertedIds: shouldApply ? insertedIds : [],
    counters,
    manifestId,
  };
}

/** Soft-delete rehydrated rows from a manifest (never hard-delete). */
export async function rollbackRehydrateManifest(manifestId, { actorId = null } = {}) {
  const id = String(manifestId || '').trim();
  const { data } = await queryCollection(REHYDRATE_MANIFEST_COLLECTION, {
    filter: { _id: id },
    limit: 1,
  });
  const manifest = data?.[0];
  if (!manifest) {
    const err = new Error('Rehydrate manifest not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (manifest.rolledBackAt) {
    return { manifestId: id, alreadyRolledBack: true, results: [] };
  }
  const results = [];
  for (const campId of manifest.insertedIds || []) {
    const camp = await CampOpsCamp.findOne({ _id: campId });
    if (!camp) {
      results.push({ id: campId, ok: false, code: 'NOT_FOUND' });
      continue;
    }
    if (camp.isDeleted === true) {
      results.push({ id: campId, ok: true, alreadyDeleted: true });
      continue;
    }
    archiveCampRecord(camp, {
      actorId,
      deletionReason: `rollback:rehydrate:${id}`,
    });
    await camp.save();
    results.push({ id: campId, campId: camp.campId, ok: true, rolledBack: true });
  }
  manifest.rolledBackAt = new Date().toISOString();
  manifest.rolledBackBy = actorId ? String(actorId) : null;
  await upsertDocument(REHYDRATE_MANIFEST_COLLECTION, manifest);
  return { manifestId: id, alreadyRolledBack: false, results };
}

// silence unused ALLOWED_FROM_SNAPSHOT until field allowlists are needed
void ALLOWED_FROM_SNAPSHOT;
void path;
