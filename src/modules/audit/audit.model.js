import { defineCollection } from '../../store/filedb.js';

export const AuditLog = defineCollection('audit_logs', {
  actorType: 'USER',
  result: 'SUCCESS',
});
