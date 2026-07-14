import { defineCollection } from '../../store/filedb.js';

const Counter = defineCollection('counters');

export const softDelete = {
  isDeleted: false,
  deletedAt: null,
  deletedBy: null,
};

export async function nextCounter(name, prefix) {
  const rows = Counter._all();
  let row = rows.find((r) => String(r._id) === name);
  if (!row) {
    row = { _id: name, seq: 0 };
    rows.push(row);
  }
  row.seq = (row.seq || 0) + 1;
  Counter._write(rows);
  return `${prefix}-${String(row.seq).padStart(6, '0')}`;
}

export default Counter;
