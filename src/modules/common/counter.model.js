import { defineCollection } from '../../store/filedb.js';
import { upsertDocument } from '../../store/persistence.js';

const Counter = defineCollection('counters');

export const softDelete = {
  isDeleted: false,
  deletedAt: null,
  deletedBy: null,
};

/** Soft UI-archive (90-day retention). Records stay in DB; lists hide by default. */
export const archiveFields = {
  archivedAt: null,
  archivedBy: null,
  archiveReason: '',
  archiveWarnedAt: null,
  /** Relative path under uploads/ when non-legal attachments were moved/compressed. */
  archiveBundleKey: '',
  /** Snapshot of original attachment paths moved into the archive bundle (for restore). */
  archivedAttachmentPaths: [],
};

/**
 * Allocate the next sequence for a named counter.
 * Single-doc upsert (avoids rewriting the whole counters collection).
 * Still process-local — multi-instance needs Mongo $inc / findOneAndUpdate.
 * Recycled sequences (from deletions) are reused before incrementing.
 */
export async function nextCounter(name, prefix, opts = {}) {
  const digits = Number(opts.digits) > 0 ? Number(opts.digits) : 6;
  const separator = opts.separator != null ? String(opts.separator) : '-';
  const rows = await Counter._all();
  let row = rows.find((r) => String(r._id) === name);
  if (!row) {
    row = { _id: name, seq: 0, recycled: [] };
  }
  let seq;
  const recycled = Array.isArray(row.recycled)
    ? row.recycled.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (recycled.length) {
    recycled.sort((a, b) => a - b);
    seq = recycled.shift();
    row.recycled = recycled;
  } else {
    seq = (row.seq || 0) + 1;
    row.seq = seq;
    row.recycled = [];
  }
  row.updatedAt = new Date().toISOString();
  await upsertDocument('counters', row);
  return `${prefix}${separator}${String(seq).padStart(digits, '0')}`;
}

/**
 * Release a sequence back for reuse (e.g. after billing document delete).
 * If it was the latest allocated value, the counter is decremented; otherwise
 * it is added to the recycled pool for the next allocation.
 */
export async function releaseCounterSequence(name, sequence) {
  const seq = Number(sequence);
  if (!name || !(seq > 0) || !Number.isFinite(seq)) return false;
  const rows = await Counter._all();
  let row = rows.find((r) => String(r._id) === name);
  if (!row) {
    row = { _id: name, seq: 0, recycled: [] };
  }
  const recycled = Array.isArray(row.recycled)
    ? row.recycled.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (Number(row.seq) === seq) {
    row.seq = Math.max(0, Number(row.seq) - 1);
    row.recycled = recycled.filter((n) => n !== seq && n <= row.seq);
  } else if (seq < Number(row.seq || 0)) {
    if (!recycled.includes(seq)) recycled.push(seq);
    recycled.sort((a, b) => a - b);
    row.recycled = recycled;
  } else {
    return false;
  }
  row.updatedAt = new Date().toISOString();
  await upsertDocument('counters', row);
  return true;
}

export default Counter;
