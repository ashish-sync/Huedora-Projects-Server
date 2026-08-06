import { defineCollection } from '../../store/filedb.js';
import { upsertDocument } from '../../store/persistence.js';

const Counter = defineCollection('counters');

export const softDelete = {
  isDeleted: false,
  deletedAt: null,
  deletedBy: null,
};

/**
 * Allocate the next sequence for a named counter.
 * Single-doc upsert (avoids rewriting the whole counters collection).
 * Still process-local — multi-instance needs Mongo $inc / findOneAndUpdate.
 */
export async function nextCounter(name, prefix, opts = {}) {
  const digits = Number(opts.digits) > 0 ? Number(opts.digits) : 6;
  const separator = opts.separator != null ? String(opts.separator) : '-';
  const rows = await Counter._all();
  let row = rows.find((r) => String(r._id) === name);
  if (!row) {
    row = { _id: name, seq: 0 };
  }
  row.seq = (row.seq || 0) + 1;
  row.updatedAt = new Date().toISOString();
  await upsertDocument('counters', row);
  return `${prefix}${separator}${String(row.seq).padStart(digits, '0')}`;
}

export default Counter;
