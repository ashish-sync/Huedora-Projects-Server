import { defineCollection } from '../../store/filedb.js';
import { archiveFields } from '../common/counter.model.js';

export const Notification = defineCollection('notifications', {
  ...archiveFields,
  channel: 'IN_APP',
  emailStatus: 'SKIPPED',
  deliveryAttempts: 0,
  deliveryError: '',
  readAt: null,
  scheduledFor: null,
  deliveredAt: null,
  cancelledAt: null,
  /** informational | important | critical */
  priority: 'informational',
  module: 'system',
  groupKey: null,
  groupCount: 1,
  groupedAt: null,
  actorId: null,
  actorEmail: null,
  changes: [],
  /** Set when soft-archived by 7-day notification TTL. */
  autoArchivedAt: null,
});
