import { defineCollection } from '../../store/filedb.js';

const Counter = defineCollection('counters');

export const softDelete = {
  isDeleted: false,
  deletedAt: null,
  deletedBy: null,
};

export async function nextCounter(name, prefix, opts = {}) {
  const digits = Number(opts.digits) > 0 ? Number(opts.digits) : 6;
  const separator = opts.separator != null ? String(opts.separator) : '-';
  const rows = Counter._all();
  let row = rows.find((r) => String(r._id) === name);
  if (!row) {
    row = { _id: name, seq: 0 };
    rows.push(row);
  }
  row.seq = (row.seq || 0) + 1;
  Counter._write(rows);
  return `${prefix}${separator}${String(row.seq).padStart(digits, '0')}`;
}

export default Counter;
