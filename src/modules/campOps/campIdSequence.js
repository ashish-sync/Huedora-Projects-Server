/**
 * Camp One ID allocator — atomic monthly sequence, never reuses IDs.
 * Format: YY-MM-#### (e.g. 26-11-0016)
 *
 * Counter id: campOps.campId.YYYYMM
 * Soft-delete / cancel / reject must never call release on these counters.
 */

import { upsertDocument, getPersistenceMode, getMongoDb, queryCollection } from '../../store/persistence.js';
import { parseLocalDateInput } from './campOps.helpers.js';

export const CAMP_ID_DIGITS = 4;
export const CAMP_ID_COUNTER_PREFIX = 'campOps.campId.';

const monthLocks = new Map();

export function withMonthLock(counterId, fn) {
  const key = String(counterId || '');
  const prev = monthLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  monthLocks.set(key, prev.then(() => gate, () => gate));
  return prev
    .catch(() => {})
    .then(() => fn())
    .finally(() => {
      release();
      if (monthLocks.get(key) === gate) monthLocks.delete(key);
    });
}

export function parseCampId(value) {
  const text = String(value || '')
    .trim()
    .toUpperCase();
  const match = /^(\d{2})-(\d{2})-(\d{3,})$/.exec(text);
  if (!match) return null;
  return {
    yy: match[1],
    mm: match[2],
    sequence: Number(match[3]),
    prefix: `${match[1]}-${match[2]}-`,
  };
}

export function formatCampId(yy, mm, sequence) {
  const seq = Number(sequence);
  const padded = String(Number.isFinite(seq) && seq > 0 ? seq : 0).padStart(CAMP_ID_DIGITS, '0');
  return `${String(yy).padStart(2, '0').slice(-2)}-${String(mm).padStart(2, '0')}-${padded}`;
}

/** Calendar period from camp date (local), matching legacy generateCampId. */
export function campIdPeriod(campDate = new Date()) {
  let date;
  if (typeof campDate === 'string') {
    const iso = parseLocalDateInput(campDate);
    date = iso ? new Date(`${iso}T12:00:00`) : new Date(campDate);
  } else if (campDate instanceof Date) {
    date = campDate;
  } else {
    date = new Date(campDate);
  }
  if (Number.isNaN(date.getTime())) date = new Date();
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const yy = String(year).slice(-2);
  const mm = String(month).padStart(2, '0');
  const yyyymm = `${year}${mm}`;
  return {
    year,
    yy,
    mm,
    yyyymm,
    prefix: `${yy}-${mm}-`,
    counterId: `${CAMP_ID_COUNTER_PREFIX}${yyyymm}`,
  };
}

export function campIdCounterName(yyyymm) {
  return `${CAMP_ID_COUNTER_PREFIX}${String(yyyymm)}`;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Max numeric seq for a YY-MM- prefix across ALL camps (including soft-deleted). */
export async function maxCampIdSeqForPrefix(prefix) {
  const safe = escapeRegex(prefix);
  const { data: rows } = await queryCollection('camp_ops_camps', {
    filter: { campId: { $regex: `^${safe}` } },
    projection: { campId: 1, isDeleted: 1 },
  });
  let maxSeq = 0;
  for (const row of rows || []) {
    const parsed = parseCampId(row.campId);
    if (!parsed) continue;
    if (parsed.prefix !== prefix) continue;
    if (parsed.sequence > maxSeq) maxSeq = parsed.sequence;
  }
  return maxSeq;
}

export async function findDuplicateCampIdGroups() {
  const { data: rows } = await queryCollection('camp_ops_camps', {
    filter: {},
    projection: { _id: 1, campId: 1, createdAt: 1, isDeleted: 1, campDate: 1, doctorCode: 1 },
  });
  const byId = new Map();
  for (const row of rows || []) {
    const campId = String(row.campId || '').trim();
    if (!campId) continue;
    if (!byId.has(campId)) byId.set(campId, []);
    byId.get(campId).push(row);
  }
  const duplicates = [];
  for (const [campId, group] of byId.entries()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => {
      const ta = String(a.createdAt || '');
      const tb = String(b.createdAt || '');
      if (ta !== tb) return ta.localeCompare(tb);
      return String(a._id).localeCompare(String(b._id));
    });
    duplicates.push({ campId, rows: sorted });
  }
  return duplicates.sort((a, b) => a.campId.localeCompare(b.campId));
}

/**
 * Ensure counter high-water mark is at least floorSeq (from existing camps / evidence).
 * Never lowers an existing counter.
 */
export async function ensureCampIdCounterInitialized(period, floorSeq = 0) {
  const counterId = period.counterId || campIdCounterName(period.yyyymm);
  const fromCamps = await maxCampIdSeqForPrefix(period.prefix);
  const target = Math.max(Number(floorSeq) || 0, fromCamps);

  return withMonthLock(counterId, async () => {
    if (getPersistenceMode() === 'mongo') {
      const db = getMongoDb();
      if (!db) throw new Error('MongoDB persistence is not configured');
      const col = db.collection('tylo_counters');
      const existing = await col.findOne({ _id: counterId });
      const current = Number(existing?.seq) || 0;
      if (current >= target && existing) {
        return { counterId, seq: current, initialized: false };
      }
      const nextSeq = Math.max(current, target);
      await col.updateOne(
        { _id: counterId },
        {
          $set: {
            seq: nextSeq,
            recycled: [],
            neverReuse: true,
            format: 'YY-MM-####',
            yy: period.yy,
            mm: period.mm,
            initializedFrom: existing ? existing.initializedFrom || 'migration' : 'migration',
            updatedAt: new Date().toISOString(),
          },
          $setOnInsert: { _id: counterId },
        },
        { upsert: true }
      );
      return { counterId, seq: nextSeq, initialized: current < target || !existing };
    }

    const { loadCollection } = await import('../../store/persistence.js');
    const rows = await loadCollection('counters');
    let row = rows.find((r) => String(r._id) === counterId);
    const current = Number(row?.seq) || 0;
    if (row && current >= target) {
      return { counterId, seq: current, initialized: false };
    }
    const nextSeq = Math.max(current, target);
    row = {
      ...(row || {}),
      _id: counterId,
      seq: nextSeq,
      recycled: [],
      neverReuse: true,
      format: 'YY-MM-####',
      yy: period.yy,
      mm: period.mm,
      initializedFrom: row?.initializedFrom || 'migration',
      updatedAt: new Date().toISOString(),
    };
    await upsertDocument('counters', row);
    return { counterId, seq: nextSeq, initialized: true };
  });
}

/** Initialize all monthly counters from every camp row (including deleted). */
export async function initializeAllCampIdCounters(extraFloors = {}) {
  const { data: rows } = await queryCollection('camp_ops_camps', {
    filter: {},
    projection: { campId: 1 },
  });
  const floors = { ...extraFloors };
  for (const row of rows || []) {
    const parsed = parseCampId(row.campId);
    if (!parsed) continue;
    const yyyymm = `20${parsed.yy}${parsed.mm}`;
    floors[yyyymm] = Math.max(Number(floors[yyyymm]) || 0, parsed.sequence);
  }
  const results = [];
  for (const yyyymm of Object.keys(floors).sort()) {
    const yy = yyyymm.slice(2, 4);
    const mm = yyyymm.slice(4, 6);
    const period = {
      year: Number(yyyymm.slice(0, 4)),
      yy,
      mm,
      yyyymm,
      prefix: `${yy}-${mm}-`,
      counterId: campIdCounterName(yyyymm),
    };
    results.push(await ensureCampIdCounterInitialized(period, floors[yyyymm]));
  }
  return results;
}

async function atomicIncrementCampIdCounter(period) {
  const counterId = period.counterId;
  if (getPersistenceMode() === 'mongo') {
    const db = getMongoDb();
    if (!db) throw new Error('MongoDB persistence is not configured');
    const col = db.collection('tylo_counters');
    const updated = await col.findOneAndUpdate(
      { _id: counterId },
      {
        $inc: { seq: 1 },
        $set: {
          neverReuse: true,
          recycled: [],
          format: 'YY-MM-####',
          yy: period.yy,
          mm: period.mm,
          updatedAt: new Date().toISOString(),
        },
        $setOnInsert: {
          _id: counterId,
          initializedFrom: 'allocate',
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    const doc = updated?.value || updated;
    const seq = Number(doc?.seq);
    if (!(seq > 0)) throw new Error(`Camp ID counter failed for ${counterId}`);
    return seq;
  }

  const { loadCollection } = await import('../../store/persistence.js');
  const rows = await loadCollection('counters');
  let row = rows.find((r) => String(r._id) === counterId);
  const nextSeq = (Number(row?.seq) || 0) + 1;
  row = {
    ...(row || {}),
    _id: counterId,
    seq: nextSeq,
    recycled: [],
    neverReuse: true,
    format: 'YY-MM-####',
    yy: period.yy,
    mm: period.mm,
    initializedFrom: row?.initializedFrom || 'allocate',
    updatedAt: new Date().toISOString(),
  };
  await upsertDocument('counters', row);
  return nextSeq;
}

/**
 * Allocate next Camp ID for campDate's calendar month.
 * Permanently reserves the sequence even if the subsequent camp insert fails.
 */
export async function allocateCampId(campDate = new Date()) {
  const period = campIdPeriod(campDate);
  return withMonthLock(period.counterId, async () => {
    // Lazy floor from existing camps (incl. deleted) so first mint after deploy is safe.
    const floor = await maxCampIdSeqForPrefix(period.prefix);
    if (getPersistenceMode() === 'mongo') {
      const db = getMongoDb();
      const col = db.collection('tylo_counters');
      const existing = await col.findOne({ _id: period.counterId });
      const current = Number(existing?.seq) || 0;
      if (!existing || current < floor) {
        await col.updateOne(
          { _id: period.counterId },
          {
            $set: {
              seq: Math.max(current, floor),
              recycled: [],
              neverReuse: true,
              format: 'YY-MM-####',
              yy: period.yy,
              mm: period.mm,
              initializedFrom: existing?.initializedFrom || 'lazy',
              updatedAt: new Date().toISOString(),
            },
            $setOnInsert: { _id: period.counterId },
          },
          { upsert: true }
        );
      }
    } else {
      const { loadCollection } = await import('../../store/persistence.js');
      const rows = await loadCollection('counters');
      const existing = rows.find((r) => String(r._id) === period.counterId);
      const current = Number(existing?.seq) || 0;
      if (!existing || current < floor) {
        await upsertDocument('counters', {
          ...(existing || {}),
          _id: period.counterId,
          seq: Math.max(current, floor),
          recycled: [],
          neverReuse: true,
          format: 'YY-MM-####',
          yy: period.yy,
          mm: period.mm,
          initializedFrom: existing?.initializedFrom || 'lazy',
          updatedAt: new Date().toISOString(),
        });
      }
    }
    const seq = await atomicIncrementCampIdCounter(period);
    return formatCampId(period.yy, period.mm, seq);
  });
}

/** FileDB / pre-insert guard — true if campId already exists (any deletion state). */
export async function campIdExists(campId) {
  const id = String(campId || '').trim();
  if (!id) return false;
  const { data: rows } = await queryCollection('camp_ops_camps', {
    filter: { campId: id },
    projection: { _id: 1 },
    limit: 1,
  });
  return Array.isArray(rows) && rows.length > 0;
}

export function isCampIdUniqueViolation(err) {
  if (!err) return false;
  if (err.code === 11000 && /campId|uniq_campId/i.test(String(err.message || err.errmsg || ''))) {
    return true;
  }
  if (err.code === 'CAMP_ID_CONFLICT') return true;
  return /duplicate.*campId|campId.*duplicate|uniq_campId/i.test(String(err.message || ''));
}

/**
 * Inventory Camp IDs per month — live, soft-deleted, max seq, holes, duplicate groups.
 */
export async function inventoryCampIds() {
  const { data: rows } = await queryCollection('camp_ops_camps', {
    filter: {},
    projection: {
      _id: 1,
      campId: 1,
      isDeleted: 1,
      createdAt: 1,
      campDate: 1,
      doctorName: 1,
      clientName: 1,
    },
  });
  const byMonth = new Map();
  for (const row of rows || []) {
    const parsed = parseCampId(row.campId);
    if (!parsed) continue;
    const key = `${parsed.yy}-${parsed.mm}`;
    if (!byMonth.has(key)) {
      byMonth.set(key, {
        yy: parsed.yy,
        mm: parsed.mm,
        yyyymm: `20${parsed.yy}${parsed.mm}`,
        prefix: parsed.prefix,
        live: [],
        deleted: [],
        sequences: new Set(),
      });
    }
    const bucket = byMonth.get(key);
    bucket.sequences.add(parsed.sequence);
    const entry = {
      _id: row._id,
      campId: row.campId,
      sequence: parsed.sequence,
      createdAt: row.createdAt,
      campDate: row.campDate,
    };
    if (row.isDeleted) bucket.deleted.push(entry);
    else bucket.live.push(entry);
  }

  const months = [...byMonth.values()]
    .sort((a, b) => a.yyyymm.localeCompare(b.yyyymm))
    .map((m) => {
      const maxSeq = m.sequences.size ? Math.max(...m.sequences) : 0;
      const holes = [];
      for (let i = 1; i <= maxSeq; i += 1) {
        if (!m.sequences.has(i)) holes.push(i);
      }
      return {
        yy: m.yy,
        mm: m.mm,
        yyyymm: m.yyyymm,
        prefix: m.prefix,
        liveCount: m.live.length,
        deletedCount: m.deleted.length,
        maxSeq,
        holes,
        liveIds: m.live.map((r) => r.campId).sort(),
        deletedIds: m.deleted.map((r) => r.campId).sort(),
      };
    });

  const duplicates = await findDuplicateCampIdGroups();
  return {
    totalCamps: (rows || []).length,
    months,
    duplicates: duplicates.map((g) => ({
      campId: g.campId,
      count: g.rows.length,
      keepId: g.rows[0]._id,
      reassignIds: g.rows.slice(1).map((r) => r._id),
      rows: g.rows.map((r) => ({
        _id: r._id,
        createdAt: r.createdAt,
        isDeleted: r.isDeleted,
        campDate: r.campDate,
      })),
    })),
    indexReady: duplicates.length === 0,
  };
}

/**
 * Gated dedupe: keep oldest row per colliding campId; assign new IDs to newer rows.
 * Dry-run by default unless apply=true and TYLO_CAMP_ID_DEDUP=1.
 */
export async function dedupeDuplicateCampIds({
  dryRun = true,
  apply = false,
  actorId = 'script:camp-id-dedup',
} = {}) {
  const envOk = String(process.env.TYLO_CAMP_ID_DEDUP || '') === '1';
  const shouldApply = Boolean(apply) && envOk && !dryRun;
  const groups = await findDuplicateCampIdGroups();
  const changes = [];

  for (const group of groups) {
    const [keep, ...rest] = group.rows;
    for (const row of rest) {
      const campDate = row.campDate || row.createdAt || new Date();
      let newCampId = null;
      if (shouldApply) {
        newCampId = await allocateCampId(campDate);
        const { upsertDocument: upsert } = await import('../../store/persistence.js');
        await upsert('camp_ops_camps', {
          ...row,
          campId: newCampId,
          updatedAt: new Date().toISOString(),
          campIdDedupedAt: new Date().toISOString(),
          campIdDedupedFrom: group.campId,
        });
        try {
          const { writeAudit } = await import('../../utils/audit.js');
          await writeAudit({
            actorId,
            actorType: 'SYSTEM',
            action: 'camp_ops.camp_id_dedup',
            entityType: 'camp_ops_camp',
            entityId: row._id,
            before: { campId: group.campId },
            after: { campId: newCampId },
            message: `Dedupe campId ${group.campId} → ${newCampId} (kept ${keep._id})`,
          });
        } catch {
          /* audit must not block remediation */
        }
      }
      changes.push({
        _id: row._id,
        from: group.campId,
        to: shouldApply ? newCampId : '(pending allocate)',
        keepId: keep._id,
        campDate: row.campDate,
        applied: shouldApply,
      });
    }
  }

  return {
    dryRun: !shouldApply,
    envGate: envOk,
    applied: shouldApply,
    duplicateGroups: groups.length,
    changes,
  };
}
