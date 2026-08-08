import { AuditLog } from '../modules/audit/audit.model.js';
import { sanitizeAuditSnapshot } from './stripEmbeddedMedia.js';

export async function writeAudit({
  actorId = null,
  actorType = 'USER',
  actorEmail = null,
  action,
  entityType = null,
  entityId = null,
  before = null,
  after = null,
  ip = null,
  userAgent = null,
  requestId = null,
  result = 'SUCCESS',
  message = null,
}) {
  await AuditLog.create({
    at: new Date(),
    actorId,
    actorType,
    actorEmail,
    action,
    entityType,
    entityId,
    before: before == null ? null : sanitizeAuditSnapshot(before),
    after: after == null ? null : sanitizeAuditSnapshot(after),
    ip,
    userAgent,
    requestId,
    result,
    message,
  });
}
