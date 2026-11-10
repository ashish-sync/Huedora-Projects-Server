import { AuditLog } from '../modules/audit/audit.model.js';
import { sanitizeAuditSnapshot } from './stripEmbeddedMedia.js';
import { buildAuditChanges, summarizeChanges } from '../modules/notifications/fieldDiff.js';
import {
  isSensitiveActivityAction,
  resolveActivityModule,
  resolveActivitySeverity,
  resolveActivitySource,
  resolveActivityType,
} from '../modules/audit/activityLog.js';

/**
 * Append-only activity event writer.
 * New fields are optional so existing call sites keep working; catalog fills defaults.
 * Failures are logged and do not throw (callers must not lose the business write).
 */
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
  module = null,
  source = null,
  severity = null,
  reason = null,
  programmeId = null,
  activityType = null,
  relatedEventId = null,
  reversalOfEventId = null,
  reversedByEventId = null,
} = {}) {
  try {
    const beforeSnap = before == null ? null : sanitizeAuditSnapshot(before);
    const afterSnap = after == null ? null : sanitizeAuditSnapshot(after);
    let msg = message;
    if (!msg && beforeSnap && afterSnap) {
      const changes = buildAuditChanges(beforeSnap, afterSnap);
      if (changes.length) msg = summarizeChanges(changes);
    }

    const resolvedModule = module
      || resolveActivityModule(action, entityType, actorType).id;
    const resolvedSource = resolveActivitySource({ source, action, actorType });
    const resolvedSeverity = resolveActivitySeverity(action, severity);
    const resolvedType = resolveActivityType(action, activityType);
    const reasonText = reason == null ? null : String(reason).trim() || null;

    if (isSensitiveActivityAction(action) && !reasonText) {
      console.warn(
        `[audit] sensitive action missing reason: ${action} entity=${entityType || ''}/${entityId || ''}`,
      );
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
      module: resolvedModule,
      source: resolvedSource,
      severity: resolvedSeverity,
      activityType: resolvedType,
      reason: reasonText,
      programmeId: programmeId == null || programmeId === '' ? null : String(programmeId),
      relatedEventId: relatedEventId || null,
      reversalOfEventId: reversalOfEventId || null,
      reversedByEventId: reversedByEventId || null,
    });
  } catch (err) {
    console.error('[audit] writeAudit failed', {
      action,
      entityType,
      entityId,
      message: err?.message,
    });
  }
}

export { buildAuditChanges, summarizeChanges };
