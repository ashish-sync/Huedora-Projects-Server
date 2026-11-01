import { Notification } from './notification.model.js';

export async function markMatchingNotificationsActioned({
  type,
  entityId,
  decision,
  actorId = null,
} = {}) {
  const eventType = String(type || '').trim();
  const id = String(entityId || '').trim();
  if (!eventType || !id) return 0;

  const now = new Date().toISOString();
  const rows = await Notification.find({
    type: eventType,
    entityId: id,
  });
  let marked = 0;
  for (const row of rows) {
    if (row.cancelledAt) continue;
    row.readAt = row.readAt || now;
    row.meta = {
      ...(row.meta && typeof row.meta === 'object' ? row.meta : {}),
      decision: String(decision || 'done'),
      actionedAt: now,
      actionedBy: actorId || null,
    };
    await row.save();
    marked += 1;
  }
  return marked;
}
