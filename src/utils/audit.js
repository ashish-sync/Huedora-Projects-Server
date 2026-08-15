import { AuditLog } from '../modules/audit/audit.model.js';
import { sanitizeAuditSnapshot } from './stripEmbeddedMedia.js';
import { buildAuditChanges, summarizeChanges } from '../modules/notifications/fieldDiff.js';

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
  const beforeSnap = before == null ? null : sanitizeAuditSnapshot(before);
  const afterSnap = after == null ? null : sanitizeAuditSnapshot(after);
  let msg = message;
  if (!msg && beforeSnap && afterSnap) {
    const changes = buildAuditChanges(beforeSnap, afterSnap);
    if (changes.length) msg = summarizeChanges(changes);
  }
  await AuditLog.create({
    at: new Date(),
    actorId,
    actorType,
    actorEmail,
    action,
    entityType,
    entityId,
    before: beforeSnap,
    after: afterSnap,
    ip,
    userAgent,
    requestId,
    result,
    message: msg,
  });
}

export { buildAuditChanges, summarizeChanges };

