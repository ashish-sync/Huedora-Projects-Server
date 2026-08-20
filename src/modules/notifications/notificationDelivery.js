/**
 * Notification delivery with bounded retry for channel failures.
 * In-app rows always persist; external channel failures are recorded and retriable.
 */
import { Notification } from './notification.model.js';

export async function markNotificationDelivery(notificationId, { status, error = '' } = {}) {
  const row = await Notification.findOne({ _id: notificationId });
  if (!row || row.isDeleted) return null;
  row.emailStatus = status || row.emailStatus;
  row.deliveryError = error ? String(error).slice(0, 500) : '';
  row.deliveryAttempts = (Number(row.deliveryAttempts) || 0) + 1;
  if (status === 'sent' || status === 'delivered') {
    row.deliveredAt = new Date().toISOString();
    row.deliveryError = '';
  }
  await row.save();
  return row;
}

/**
 * Retry failed external deliveries. Provider is injected for testability.
 * @param {{ send: (row) => Promise<void>, maxAttempts?: number, limit?: number }} opts
 */
export async function retryFailedNotificationDeliveries({
  send,
  maxAttempts = 3,
  limit = 50,
} = {}) {
  if (typeof send !== 'function') {
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
  }
  const rows = await Notification.find({
    emailStatus: { $in: ['failed', 'queued', 'pending'] },
  })
    .sort('createdAt')
    .limit(limit);

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    if (row.isDeleted) {
      skipped += 1;
      continue;
    }
    const attempts = Number(row.deliveryAttempts) || 0;
    if (attempts >= maxAttempts) {
      skipped += 1;
      continue;
    }
    attempted += 1;
    try {
      await send(row);
      await markNotificationDelivery(row._id, { status: 'sent' });
      succeeded += 1;
    } catch (err) {
      await markNotificationDelivery(row._id, {
        status: 'failed',
        error: err?.message || String(err),
      });
      failed += 1;
    }
  }

  return { attempted, succeeded, failed, skipped };
}
