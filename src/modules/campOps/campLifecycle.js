/**
 * Camp One soft-delete / restore lifecycle.
 * Soft-delete never releases Camp IDs. Cancelled/rejected/executed stay live rows.
 */

import { randomUUID } from 'crypto';
import { upsertDocument, queryCollection } from '../../store/persistence.js';
import { CampOpsCamp } from './campOps.model.js';

export const RESTORE_BATCH_COLLECTION = 'camp_ops_restore_batches';

export function archiveCampRecord(camp, { actorId = null, deletedAt = null, deletionReason = null } = {}) {
  if (!camp) return camp;
  const now = deletedAt || new Date().toISOString();
  camp.isDeleted = true;
  camp.deletedAt = now;
  camp.deletedBy = actorId ? String(actorId) : null;
  if (deletionReason != null) {
    const reason = String(deletionReason).trim();
    camp.deletionReason = reason || camp.deletionReason || '';
  }
  return camp;
}

/**
 * Clear soft-delete flags. Idempotent when already live.
 * Preserves campId, documents, finance, timestamps.
 */
export function restoreCampRecord(camp, { actorId = null, reason = '', restoredAt = null } = {}) {
  if (!camp) return camp;
  const alreadyLive = camp.isDeleted !== true;
  const now = restoredAt || new Date().toISOString();
  if (!alreadyLive) {
    camp.isDeleted = false;
    camp.deletedAt = null;
    camp.deletedBy = null;
  }
  camp.restoredAt = now;
  camp.restoredBy = actorId ? String(actorId) : null;
  camp.restoreReason = String(reason || '').trim() || camp.restoreReason || '';
  return { camp, alreadyLive, restored: !alreadyLive };
}

export async function findCampByIdAnyState(id) {
  return CampOpsCamp.findOne({ _id: String(id) });
}

export async function restoreCampById(id, { actorId = null, reason = '' } = {}) {
  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) {
    const err = new Error('Restore reason is required');
    err.code = 'RESTORE_REASON_REQUIRED';
    throw err;
  }
  const camp = await findCampByIdAnyState(id);
  if (!camp) {
    const err = new Error('Camp not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const before = typeof camp.toObject === 'function' ? camp.toObject() : { ...camp };
  const result = restoreCampRecord(camp, { actorId, reason: trimmedReason });
  if (result.restored) {
    await camp.save();
  }
  const after = typeof camp.toObject === 'function' ? camp.toObject() : { ...camp };
  return {
    camp,
    before,
    after,
    alreadyLive: result.alreadyLive,
    restored: result.restored,
  };
}

export async function createRestoreBatch({
  ids = [],
  reason = '',
  actorId = null,
  dryRun = false,
} = {}) {
  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) {
    const err = new Error('Restore reason is required');
    err.code = 'RESTORE_REASON_REQUIRED';
    throw err;
  }
  const uniqueIds = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const batchId = randomUUID();
  const results = [];
  const restoredIds = [];

  for (const id of uniqueIds) {
    try {
      const camp = await findCampByIdAnyState(id);
      if (!camp) {
        results.push({ id, ok: false, code: 'NOT_FOUND', message: 'Camp not found' });
        continue;
      }
      const alreadyLive = camp.isDeleted !== true;
      if (alreadyLive) {
        results.push({
          id,
          campId: camp.campId,
          ok: true,
          restored: false,
          alreadyLive: true,
        });
        continue;
      }
      if (dryRun) {
        results.push({
          id,
          campId: camp.campId,
          ok: true,
          restored: true,
          dryRun: true,
          alreadyLive: false,
        });
        restoredIds.push(id);
        continue;
      }
      const before = typeof camp.toObject === 'function' ? camp.toObject() : { ...camp };
      restoreCampRecord(camp, { actorId, reason: trimmedReason });
      await camp.save();
      results.push({
        id,
        campId: camp.campId,
        ok: true,
        restored: true,
        alreadyLive: false,
        before,
        after: typeof camp.toObject === 'function' ? camp.toObject() : { ...camp },
      });
      restoredIds.push(id);
    } catch (err) {
      results.push({
        id,
        ok: false,
        code: err.code || 'RESTORE_FAILED',
        message: err.message || String(err),
      });
    }
  }

  const batch = {
    _id: batchId,
    batchId,
    reason: trimmedReason,
    actorId: actorId ? String(actorId) : null,
    dryRun: Boolean(dryRun),
    createdAt: new Date().toISOString(),
    restoredIds: dryRun ? [] : restoredIds,
    plannedIds: dryRun ? restoredIds : [],
    rolledBackAt: null,
    results: results.map((r) => ({
      id: r.id,
      campId: r.campId,
      ok: r.ok,
      restored: r.restored,
      alreadyLive: r.alreadyLive,
      dryRun: r.dryRun,
      code: r.code,
      message: r.message,
    })),
  };

  if (!dryRun) {
    await upsertDocument(RESTORE_BATCH_COLLECTION, batch);
  }

  return { batchId, dryRun: Boolean(dryRun), results, restoredIds: batch.restoredIds, batch };
}

export async function rollbackRestoreBatch(batchId, { actorId = null, reason = '' } = {}) {
  const id = String(batchId || '').trim();
  if (!id) {
    const err = new Error('batchId is required');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const { data } = await queryCollection(RESTORE_BATCH_COLLECTION, {
    filter: { _id: id },
    limit: 1,
  });
  const batch = data?.[0];
  if (!batch) {
    const err = new Error('Restore batch not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (batch.rolledBackAt) {
    return { batchId: id, alreadyRolledBack: true, results: [] };
  }
  const rollbackReason =
    String(reason || '').trim() || `rollback:${id}`;
  const results = [];
  for (const campId of batch.restoredIds || []) {
    const camp = await findCampByIdAnyState(campId);
    if (!camp) {
      results.push({ id: campId, ok: false, code: 'NOT_FOUND' });
      continue;
    }
    if (camp.isDeleted === true) {
      results.push({ id: campId, campId: camp.campId, ok: true, alreadyDeleted: true });
      continue;
    }
    archiveCampRecord(camp, {
      actorId,
      deletionReason: rollbackReason,
    });
    await camp.save();
    results.push({ id: campId, campId: camp.campId, ok: true, rolledBack: true });
  }
  batch.rolledBackAt = new Date().toISOString();
  batch.rolledBackBy = actorId ? String(actorId) : null;
  batch.rollbackReason = rollbackReason;
  await upsertDocument(RESTORE_BATCH_COLLECTION, batch);
  return { batchId: id, alreadyRolledBack: false, results };
}
