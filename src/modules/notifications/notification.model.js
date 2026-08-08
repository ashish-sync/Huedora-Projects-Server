import { defineCollection } from '../../store/filedb.js';
import { archiveFields } from '../common/counter.model.js';

export const Notification = defineCollection('notifications', {
  ...archiveFields,
  channel: 'IN_APP',
  emailStatus: 'SKIPPED',
  readAt: null,
  scheduledFor: null,
  deliveredAt: null,
  cancelledAt: null,
});
