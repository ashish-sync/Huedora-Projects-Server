import { defineCollection } from '../../store/filedb.js';

export const Notification = defineCollection('notifications', {
  channel: 'IN_APP',
  emailStatus: 'SKIPPED',
  readAt: null,
  scheduledFor: null,
  deliveredAt: null,
  cancelledAt: null,
});
