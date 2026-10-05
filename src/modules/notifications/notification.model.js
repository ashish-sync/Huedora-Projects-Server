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
  /** Inbox bucket: approval | update (persisted for fast filtering). */
  kind: 'update',
  /** Legacy soft-archive stamp (TTL now hard-deletes eligible rows). */
  autoArchivedAt: null,
});
