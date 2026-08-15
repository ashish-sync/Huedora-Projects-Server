import { defineCollection } from '../../store/filedb.js';

export const EntityWatch = defineCollection('entity_watches', {
  userId: null,
  entityType: '',
  entityId: '',
});

export function watchKey(userId, entityType, entityId) {
  return `${String(userId)}::${String(entityType)}::${String(entityId)}`;
}

export async function findWatcherUserIds(entityType, entityId) {
  if (!entityType || !entityId) return [];
  const rows = await EntityWatch.find({
    entityType: String(entityType),
    entityId: String(entityId),
  }).limit(500);
  const ids = new Set();
  for (const row of rows) {
    if (row?.userId) ids.add(String(row.userId));
  }
  return Array.from(ids);
}

export async function findWatchForUser(userId, entityType, entityId) {
  if (!userId || !entityType || !entityId) return null;
  const rows = await EntityWatch.find({
    userId: String(userId),
    entityType: String(entityType),
    entityId: String(entityId),
  }).limit(1);
  return rows[0] || null;
}
