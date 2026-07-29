import { defineCollection } from '../../store/filedb.js';

const AppState = defineCollection('app_state');

export async function getAppState(key, defaults = {}) {
  const row = await AppState.findById(String(key));
  if (!row) return { _id: String(key), ...defaults };
  const obj = row.toObject();
  delete obj.toObject;
  delete obj.save;
  delete obj.populate;
  return obj;
}

export async function setAppState(key, patch) {
  const id = String(key);
  const existing = await AppState.findById(id);
  const now = new Date().toISOString();
  const next = {
    ...(existing ? existing.toObject() : { _id: id, createdAt: now }),
    ...patch,
    _id: id,
    updatedAt: now,
  };
  delete next.toObject;
  delete next.save;
  delete next.populate;
  if (existing) {
    await AppState.findByIdAndUpdate(id, { $set: next });
  } else {
    await AppState.create(next);
  }
  return next;
}

export default AppState;
