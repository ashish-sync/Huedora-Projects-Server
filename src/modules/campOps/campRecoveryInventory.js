/**
 * Read-only Camp One recovery inventory.
 * Correlates camps, audits, notifications, stored_files, and local uploads.
 */

import fs from 'fs';
import path from 'path';
import { queryCollection } from '../../store/persistence.js';
import { uploadDir } from '../../config/paths.js';
import { parseCampId, findDuplicateCampIdGroups, inventoryCampIds } from './campIdSequence.js';

const FULL_SNAPSHOT_KEY_THRESHOLD = 80;
const CAMP_AUDIT_ACTIONS = new Set([
  'camp_ops.create',
  'camp_ops.program_form_create',
  'camp_ops.approve',
  'camp_ops.update',
  'camp_ops.camp_delete',
  'camp_ops.camp_id_dedup',
  'camp_ops.camp_restore',
  'camp_ops.camp_rehydrate',
  'camp_ops.execution_link_mint',
  'SYSTEM.PURGE_ALL_CAMPS',
  'SYSTEM.PURGE_CAMPS_BY_CAMPAIGN_TYPE',
  'SYSTEM.PURGE_CAMP',
]);

function snapshotKeyCount(snap) {
  if (!snap || typeof snap !== 'object') return 0;
  return Object.keys(snap).length;
}

function pickBestSnapshot(entries = []) {
  let best = null;
  let bestCount = 0;
  for (const entry of entries) {
    for (const snap of [entry.after, entry.before]) {
      const count = snapshotKeyCount(snap);
      if (count > bestCount) {
        bestCount = count;
        best = snap;
      }
    }
  }
  return { snapshot: best, keyCount: bestCount };
}

function listLocalCampOpsUploads() {
  try {
    const dir = uploadDir('camp-ops');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((name) => {
      try {
        return fs.statSync(path.join(dir, name)).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function campIdFromUploadName(name) {
  const match = /^(\d{2}-\d{2}-\d{3,})__/.exec(String(name || ''));
  return match ? match[1] : null;
}

/**
 * Build complete recovery inventory (read-only).
 */
export async function buildCampRecoveryInventory() {
  const campInventory = await inventoryCampIds();
  const { data: camps } = await queryCollection('camp_ops_camps', {
    filter: {},
    projection: {
      _id: 1,
      campId: 1,
      clientName: 1,
      clientId: 1,
      doctorName: 1,
      campDate: 1,
      status: 1,
      lifecycleStage: 1,
      isDeleted: 1,
      deletedAt: 1,
      deletedBy: 1,
      deletionReason: 1,
      archivedAt: 1,
      restoredAt: 1,
      restoreReason: 1,
      executionDocuments: 1,
      inTimeSelfieUrl: 1,
      outTimeSelfieUrl: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  });

  const byCampId = new Map();
  const byEntityId = new Map();
  for (const camp of camps || []) {
    const campId = String(camp.campId || '').trim();
    if (campId) {
      if (!byCampId.has(campId)) byCampId.set(campId, []);
      byCampId.get(campId).push(camp);
    }
    byEntityId.set(String(camp._id), camp);
  }

  const { data: audits } = await queryCollection('audit_logs', {
    filter: {},
    projection: {
      _id: 1,
      action: 1,
      entityType: 1,
      entityId: 1,
      before: 1,
      after: 1,
      at: 1,
      createdAt: 1,
      actorEmail: 1,
      reason: 1,
      message: 1,
    },
  });

  const auditsByEntity = new Map();
  const auditsByCampId = new Map();
  for (const row of audits || []) {
    const action = String(row.action || '');
    if (!CAMP_AUDIT_ACTIONS.has(action) && !/^camp_ops\./.test(action) && !/^SYSTEM\.PURGE/.test(action)) {
      continue;
    }
    const entityId = String(row.entityId || '').trim();
    const campId =
      String(row.after?.campId || row.before?.campId || '').trim() || null;
    const entry = {
      auditId: row._id,
      action,
      entityId,
      campId,
      at: row.at || row.createdAt || null,
      actorEmail: row.actorEmail || null,
      reason: row.reason || null,
      before: row.before || null,
      after: row.after || null,
      beforeKeys: snapshotKeyCount(row.before),
      afterKeys: snapshotKeyCount(row.after),
    };
    if (entityId) {
      if (!auditsByEntity.has(entityId)) auditsByEntity.set(entityId, []);
      auditsByEntity.get(entityId).push(entry);
    }
    if (campId) {
      if (!auditsByCampId.has(campId)) auditsByCampId.set(campId, []);
      auditsByCampId.get(campId).push(entry);
    }
  }

  let notifications = [];
  try {
    const notif = await queryCollection('notifications', {
      filter: {},
      projection: { _id: 1, entityId: 1, entityType: 1, title: 1, body: 1, meta: 1, createdAt: 1 },
    });
    notifications = notif.data || [];
  } catch {
    notifications = [];
  }

  let storedFiles = [];
  try {
    const sf = await queryCollection('stored_files', {
      filter: {},
      projection: { _id: 1, objectKey: 1, status: 1, fileName: 1, originalName: 1 },
    });
    storedFiles = sf.data || [];
  } catch {
    storedFiles = [];
  }

  const uploadNames = listLocalCampOpsUploads();
  const uploadsByCampId = new Map();
  for (const name of uploadNames) {
    const campId = campIdFromUploadName(name);
    if (!campId) continue;
    if (!uploadsByCampId.has(campId)) uploadsByCampId.set(campId, []);
    uploadsByCampId.get(campId).push(name);
  }

  const storedByCampId = new Map();
  for (const file of storedFiles) {
    const key = String(file.objectKey || file.fileName || '');
    const campId = campIdFromUploadName(path.basename(key));
    if (!campId) continue;
    if (!storedByCampId.has(campId)) storedByCampId.set(campId, []);
    storedByCampId.get(campId).push({
      _id: file._id,
      objectKey: file.objectKey,
      status: file.status,
    });
  }

  const liveRows = [];
  const softDeletedRows = [];
  const archivedRows = [];

  for (const camp of camps || []) {
    const row = {
      _id: camp._id,
      campId: camp.campId,
      clientName: camp.clientName,
      campDate: camp.campDate,
      status: camp.status,
      lifecycleStage: camp.lifecycleStage,
      isDeleted: Boolean(camp.isDeleted),
      deletedAt: camp.deletedAt || null,
      deletedBy: camp.deletedBy || null,
      deletionReason: camp.deletionReason || '',
      archivedAt: camp.archivedAt || null,
      restoredAt: camp.restoredAt || null,
      documentCount: Array.isArray(camp.executionDocuments) ? camp.executionDocuments.length : 0,
      feasibility: camp.isDeleted ? 'soft_delete_undelete' : 'live',
      blockers: [],
    };
    if (camp.isDeleted) softDeletedRows.push(row);
    else liveRows.push(row);
    if (camp.archivedAt) archivedRows.push(row);
  }

  const missingCandidates = [];
  const seenMissing = new Set();

  const considerMissing = (campId, entityId, source) => {
    const key = `${campId || ''}::${entityId || ''}`;
    if (seenMissing.has(key)) return;
    if (entityId && byEntityId.has(String(entityId))) return;
    if (campId && byCampId.has(campId) && !entityId) return;
    seenMissing.add(key);

    const relatedAudits = [
      ...(entityId ? auditsByEntity.get(String(entityId)) || [] : []),
      ...(campId ? auditsByCampId.get(campId) || [] : []),
    ];
    const { snapshot, keyCount } = pickBestSnapshot(relatedAudits);
    const occupiedBy = campId ? byCampId.get(campId) || [] : [];
    const uploads = campId ? uploadsByCampId.get(campId) || [] : [];
    const files = campId ? storedByCampId.get(campId) || [] : [];
    const notifHits = notifications.filter(
      (n) =>
        String(n.entityId || '') === String(entityId || '') ||
        String(n.meta?.campId || '').trim() === campId
    );

    let feasibility = 'unrecoverable';
    const blockers = [];
    if (occupiedBy.length) {
      feasibility = 'evidence_only_id_conflict';
      blockers.push(`campId ${campId} occupied by ${occupiedBy.map((c) => c._id).join(',')}`);
    } else if (keyCount >= FULL_SNAPSHOT_KEY_THRESHOLD && snapshot?.campId && snapshot?._id) {
      feasibility = 'rehydrate_free_id';
    } else if (uploads.length || files.length || keyCount > 0 || notifHits.length) {
      feasibility = 'partial_evidence';
      if (keyCount < FULL_SNAPSHOT_KEY_THRESHOLD) {
        blockers.push('audit snapshot incomplete — will not invent camp body');
      }
    } else {
      blockers.push('no verified snapshot or attachments');
    }

    missingCandidates.push({
      campId: campId || snapshot?.campId || null,
      _id: entityId || snapshot?._id || null,
      clientName: snapshot?.clientName || null,
      campDate: snapshot?.campDate || null,
      status: snapshot?.status || null,
      doctorName: snapshot?.doctorName || null,
      feasibility,
      blockers,
      auditCount: relatedAudits.length,
      snapshotKeyCount: keyCount,
      bestAuditId: relatedAudits[0]?.auditId || null,
      uploads,
      storedFiles: files,
      notificationCount: notifHits.length,
      source,
      deletionHistory: relatedAudits
        .filter((a) => /delete|purge/i.test(a.action))
        .map((a) => ({ action: a.action, at: a.at, auditId: a.auditId })),
    });
  };

  for (const [entityId, entries] of auditsByEntity.entries()) {
    if (byEntityId.has(entityId)) continue;
    const campId = entries.map((e) => e.campId).find(Boolean) || null;
    considerMissing(campId, entityId, 'audit_entity');
  }

  for (const [campId, files] of uploadsByCampId.entries()) {
    if (byCampId.has(campId)) continue;
    considerMissing(campId, null, 'orphan_upload');
    void files;
  }

  // Sequence holes with no evidence
  for (const month of campInventory.months || []) {
    for (const holeSeq of month.holes || []) {
      const campId = `${month.yy}-${month.mm}-${String(holeSeq).padStart(4, '0')}`;
      if (byCampId.has(campId)) continue;
      if (missingCandidates.some((m) => m.campId === campId)) continue;
      const related = auditsByCampId.get(campId) || [];
      if (!related.length && !(uploadsByCampId.get(campId) || []).length) {
        missingCandidates.push({
          campId,
          _id: null,
          clientName: null,
          campDate: null,
          status: null,
          doctorName: null,
          feasibility: 'unrecoverable_hole',
          blockers: ['sequence hole with no audit or upload evidence'],
          auditCount: 0,
          snapshotKeyCount: 0,
          bestAuditId: null,
          uploads: [],
          storedFiles: [],
          notificationCount: 0,
          source: 'sequence_hole',
          deletionHistory: [],
        });
      }
    }
  }

  const duplicates = await findDuplicateCampIdGroups();

  const summary = {
    generatedAt: new Date().toISOString(),
    liveCount: liveRows.length,
    softDeletedCount: softDeletedRows.length,
    archivedCount: archivedRows.length,
    missingCandidateCount: missingCandidates.length,
    rehydrateFreeIdCount: missingCandidates.filter((m) => m.feasibility === 'rehydrate_free_id').length,
    evidenceOnlyCount: missingCandidates.filter((m) => m.feasibility === 'evidence_only_id_conflict').length,
    partialEvidenceCount: missingCandidates.filter((m) => m.feasibility === 'partial_evidence').length,
    unrecoverableCount: missingCandidates.filter((m) =>
      m.feasibility === 'unrecoverable' || m.feasibility === 'unrecoverable_hole'
    ).length,
    duplicateGroups: duplicates.length,
    sequenceHoles: (campInventory.months || []).flatMap((m) =>
      (m.holes || []).map((seq) => `${m.yy}-${m.mm}-${String(seq).padStart(4, '0')}`)
    ),
  };

  return {
    summary,
    months: campInventory.months,
    live: liveRows,
    softDeleted: softDeletedRows,
    archived: archivedRows,
    missing: missingCandidates.sort((a, b) =>
      String(a.campId || '').localeCompare(String(b.campId || ''))
    ),
    duplicates: duplicates.map((g) => ({
      campId: g.campId,
      count: g.rows.length,
      ids: g.rows.map((r) => r._id),
    })),
  };
}

export function recoveryInventoryToCsv(inventory) {
  const rows = [
    ...((inventory.softDeleted || []).map((r) => ({
      class: 'soft_deleted',
      campId: r.campId,
      _id: r._id,
      clientName: r.clientName,
      campDate: r.campDate,
      status: r.status,
      feasibility: r.feasibility,
      blockers: (r.blockers || []).join('; '),
      deletedAt: r.deletedAt || '',
      deletionReason: r.deletionReason || '',
    }))),
    ...((inventory.missing || []).map((r) => ({
      class: 'missing',
      campId: r.campId,
      _id: r._id,
      clientName: r.clientName,
      campDate: r.campDate,
      status: r.status,
      feasibility: r.feasibility,
      blockers: (r.blockers || []).join('; '),
      deletedAt: '',
      deletionReason: '',
    }))),
  ];
  const headers = [
    'class',
    'campId',
    '_id',
    'clientName',
    'campDate',
    'status',
    'feasibility',
    'blockers',
    'deletedAt',
    'deletionReason',
  ];
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

export { parseCampId, FULL_SNAPSHOT_KEY_THRESHOLD };
